/**
 * Fetch RED-method metrics for the Kubernetes API server from a running
 * Prometheus instance. The apiserver is the one service every cluster has,
 * with the same metric names regardless of distro, which makes it the most
 * reliable "does my cluster stay responsive" signal.
 *
 * Metric source: kube-apiserver instrumentation, documented at
 *   https://kubernetes.io/docs/reference/instrumentation/metrics/
 * kube-prometheus-stack scrapes these by default via its built-in
 * ServiceMonitor / PodMonitor rules.
 */

import { extractScalars, instantQuery } from "./prometheus-client";
import type { PrometheusEndpoint } from "./prometheus-discovery";

export type ApiServerRedEntry = {
  verb: string;
  resource: string;
  scope: string;
  totalRate: number;
  errorRate: number;
  errorPercent: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  status: "healthy" | "degraded" | "critical";
};

export type ApiServerRedReport = {
  entries: ApiServerRedEntry[];
  summary: {
    totalRate: number;
    avgErrorPercent: number;
    avgP95LatencyMs: number;
    healthyCount: number;
    degradedCount: number;
    criticalCount: number;
  };
  windowSeconds: number;
};

function gradeEntry(errorPercent: number, p95LatencyMs: number): ApiServerRedEntry["status"] {
  // Thresholds follow the Four Golden Signals guidance:
  // https://sre.google/sre-book/monitoring-distributed-systems/
  if (errorPercent > 5 || p95LatencyMs > 5000) return "critical";
  if (errorPercent > 1 || p95LatencyMs > 1000) return "degraded";
  return "healthy";
}

function keyFor(tags: Record<string, string>): string {
  return `${tags.verb || "-"}|${tags.resource || "-"}|${tags.scope || "-"}`;
}

/**
 * Execute four PromQL queries in parallel and stitch the results into a
 * single per-(verb, resource, scope) row. Each request counter sample has
 * its label set exported by Prometheus so the vector dimensions align.
 */
export async function fetchApiServerRed(
  clusterId: string,
  endpoint: PrometheusEndpoint,
  window: string = "5m",
): Promise<ApiServerRedReport | null> {
  const rateQuery = `sum by (verb, resource, scope) (rate(apiserver_request_total[${window}]))`;
  const errorQuery = `sum by (verb, resource, scope) (rate(apiserver_request_total{code=~"5.."}[${window}]))`;
  const p95Query = `histogram_quantile(0.95, sum by (verb, resource, scope, le) (rate(apiserver_request_duration_seconds_bucket[${window}])))`;
  const p99Query = `histogram_quantile(0.99, sum by (verb, resource, scope, le) (rate(apiserver_request_duration_seconds_bucket[${window}])))`;

  const [rateResp, errResp, p95Resp, p99Resp] = await Promise.all([
    instantQuery(clusterId, endpoint, rateQuery),
    instantQuery(clusterId, endpoint, errorQuery),
    instantQuery(clusterId, endpoint, p95Query),
    instantQuery(clusterId, endpoint, p99Query),
  ]);

  if (!rateResp) return null;

  const rateByKey = new Map<string, { tags: Record<string, string>; value: number }>();
  for (const r of extractScalars(rateResp, ["verb", "resource", "scope"])) {
    rateByKey.set(keyFor(r.tags), { tags: r.tags, value: r.value });
  }
  const errByKey = new Map<string, number>();
  for (const r of extractScalars(errResp, ["verb", "resource", "scope"])) {
    errByKey.set(keyFor(r.tags), r.value);
  }
  const p95ByKey = new Map<string, number>();
  for (const r of extractScalars(p95Resp, ["verb", "resource", "scope"])) {
    p95ByKey.set(keyFor(r.tags), r.value);
  }
  const p99ByKey = new Map<string, number>();
  for (const r of extractScalars(p99Resp, ["verb", "resource", "scope"])) {
    p99ByKey.set(keyFor(r.tags), r.value);
  }

  const entries: ApiServerRedEntry[] = [];
  for (const [key, rate] of rateByKey) {
    // Skip series with effectively zero traffic - they clutter the table
    // and average-skew the summary.
    if (rate.value < 0.01) continue;
    const errRate = errByKey.get(key) ?? 0;
    const p95Seconds = p95ByKey.get(key) ?? 0;
    const p99Seconds = p99ByKey.get(key) ?? 0;
    const errorPercent = rate.value > 0 ? Math.round((errRate / rate.value) * 10000) / 100 : 0;
    const p95Ms = Number.isFinite(p95Seconds) ? Math.round(p95Seconds * 1000) : 0;
    const p99Ms = Number.isFinite(p99Seconds) ? Math.round(p99Seconds * 1000) : 0;

    entries.push({
      verb: rate.tags.verb || "-",
      resource: rate.tags.resource || "-",
      scope: rate.tags.scope || "-",
      totalRate: Math.round(rate.value * 100) / 100,
      errorRate: Math.round(errRate * 100) / 100,
      errorPercent,
      p50LatencyMs: 0, // unused in the simplified view; reserved for future drill-down
      p95LatencyMs: p95Ms,
      p99LatencyMs: p99Ms,
      status: gradeEntry(errorPercent, p95Ms),
    });
  }

  entries.sort((a, b) => b.errorPercent - a.errorPercent || b.p95LatencyMs - a.p95LatencyMs);

  const totalRate = entries.reduce((s, e) => s + e.totalRate, 0);
  const withTraffic = entries.filter((e) => e.totalRate > 0);
  const avgErr =
    withTraffic.length > 0
      ? Math.round(
          (withTraffic.reduce((s, e) => s + e.errorPercent, 0) / withTraffic.length) * 100,
        ) / 100
      : 0;
  const avgP95 =
    withTraffic.length > 0
      ? Math.round(withTraffic.reduce((s, e) => s + e.p95LatencyMs, 0) / withTraffic.length)
      : 0;

  return {
    entries,
    summary: {
      totalRate: Math.round(totalRate * 100) / 100,
      avgErrorPercent: avgErr,
      avgP95LatencyMs: avgP95,
      healthyCount: entries.filter((e) => e.status === "healthy").length,
      degradedCount: entries.filter((e) => e.status === "degraded").length,
      criticalCount: entries.filter((e) => e.status === "critical").length,
    },
    windowSeconds: parsePromWindowSeconds(window),
  };
}

function parsePromWindowSeconds(window: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(window);
  if (!match) return 300;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      return 300;
  }
}
