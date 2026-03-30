/**
 * RED Method metrics model.
 *
 * Based on: https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/
 *
 * RED = Rate, Errors, Duration - the three key signals for request-driven services.
 *
 * Prometheus metrics used:
 *   - apiserver_request_total (counter, labels: verb, code, resource)
 *     https://kubernetes.io/docs/reference/instrumentation/metrics/
 *   - apiserver_request_duration_seconds (histogram, labels: verb, resource, scope)
 *     https://kubernetes.io/docs/reference/instrumentation/metrics/
 */

export type RedMetricsEntry = {
  service: string;
  namespace: string;
  rate: number;
  errorRate: number;
  errorPercent: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  status: "healthy" | "degraded" | "critical";
};

export type RedMetricsReport = {
  entries: RedMetricsEntry[];
  summary: {
    totalRate: number;
    avgErrorPercent: number;
    avgP95LatencyMs: number;
    healthyCount: number;
    degradedCount: number;
    criticalCount: number;
  };
};

type RedInput = {
  service: string;
  namespace: string;
  totalRequests: number;
  errorRequests: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  windowSeconds: number;
};

function gradeRedEntry(errorPercent: number, p95LatencyMs: number): RedMetricsEntry["status"] {
  // Thresholds based on Four Golden Signals (SRE book)
  // https://sre.google/sre-book/monitoring-distributed-systems/
  if (errorPercent > 5 || p95LatencyMs > 5000) return "critical";
  if (errorPercent > 1 || p95LatencyMs > 1000) return "degraded";
  return "healthy";
}

export function buildRedMetrics(inputs: RedInput[]): RedMetricsReport {
  const entries: RedMetricsEntry[] = inputs.map((input) => {
    const rate = input.windowSeconds > 0 ? input.totalRequests / input.windowSeconds : 0;
    const errorRate = input.windowSeconds > 0 ? input.errorRequests / input.windowSeconds : 0;
    const errorPercent =
      input.totalRequests > 0
        ? Math.round((input.errorRequests / input.totalRequests) * 10000) / 100
        : 0;

    return {
      service: input.service,
      namespace: input.namespace,
      rate: Math.round(rate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      errorPercent,
      p50LatencyMs: input.p50LatencyMs,
      p95LatencyMs: input.p95LatencyMs,
      p99LatencyMs: input.p99LatencyMs,
      status: gradeRedEntry(errorPercent, input.p95LatencyMs),
    };
  });

  entries.sort((a, b) => b.errorPercent - a.errorPercent || b.p95LatencyMs - a.p95LatencyMs);

  const totalRate = entries.reduce((s, e) => s + e.rate, 0);
  const withTraffic = entries.filter((e) => e.rate > 0);
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
  };
}

/**
 * PromQL queries for RED metrics collection.
 *
 * Based on apiserver_request_total and apiserver_request_duration_seconds
 * from https://kubernetes.io/docs/reference/instrumentation/metrics/
 */
export const RED_PROMQL = {
  rate: (service: string, window: string) =>
    `sum(rate(apiserver_request_total{resource="${service}"}[${window}]))`,
  errorRate: (service: string, window: string) =>
    `sum(rate(apiserver_request_total{resource="${service}",code=~"5.."}[${window}]))`,
  p50Latency: (service: string, window: string) =>
    `histogram_quantile(0.50, sum(rate(apiserver_request_duration_seconds_bucket{resource="${service}"}[${window}])) by (le))`,
  p95Latency: (service: string, window: string) =>
    `histogram_quantile(0.95, sum(rate(apiserver_request_duration_seconds_bucket{resource="${service}"}[${window}])) by (le))`,
  p99Latency: (service: string, window: string) =>
    `histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket{resource="${service}"}[${window}])) by (le))`,
} as const;
