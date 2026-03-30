import { error as logError } from "@tauri-apps/plugin-log";
import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import type {
  ApiServerLatencyGroup,
  ApiServerLatencyQuantiles,
  ApiServerLatencyReport,
  ApiServerLatencyStatus,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT = "10s";
const DEFAULT_WARN_SECONDS = 1;
const DEFAULT_CRITICAL_SECONDS = 5;
const LIST_WARN_SECONDS = 30;
const LIST_CRITICAL_SECONDS = 60;
const MAX_GROUPS = 6;
const EXCLUDED_VERBS = new Set(["WATCH"]);

const cachedLatency = new Map<string, { data: ApiServerLatencyReport; fetchedAt: number }>();

type BucketKey = {
  verb?: string;
  resource?: string;
  le: number;
};

type BucketMap = Map<string, Map<number, number>>;

function parseMetricLine(
  line: string,
): { name: string; labels: Record<string, string>; value: number } | null {
  const match = line.match(
    /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/,
  );
  if (!match) return null;
  const value = Number(match[3]);
  if (!Number.isFinite(value)) return null;
  const labels: Record<string, string> = {};
  if (match[2]) {
    for (const pair of match[2].split(",")) {
      const [rawKey, rawValue] = pair.split("=");
      if (!rawKey) continue;
      labels[rawKey.trim()] = rawValue.trim().replace(/^"|"$/g, "");
    }
  }
  return { name: match[1], labels, value };
}

function bucketKey({ verb, resource }: { verb?: string; resource?: string }): string {
  return `${verb ?? "all"}|${resource ?? "all"}`;
}

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addBucket(buckets: BucketMap, key: BucketKey, value: number) {
  const groupKey = bucketKey(key);
  if (!buckets.has(groupKey)) {
    buckets.set(groupKey, new Map());
  }
  const group = buckets.get(groupKey);
  if (!group) return;
  group.set(key.le, (group.get(key.le) ?? 0) + value);
}

function isRelevantLatencyMetric(labels: Record<string, string>): boolean {
  const verb = (labels.verb || "").toUpperCase();
  if (EXCLUDED_VERBS.has(verb)) return false;

  const resource = (
    labels.resource ||
    labels.resource_subresource ||
    labels.subresource ||
    ""
  ).toLowerCase();
  if (!resource) return true;
  if (resource.startsWith("/")) return false;
  if (resource.includes("healthz") || resource.includes("readyz") || resource.includes("livez")) {
    return false;
  }
  if (resource.startsWith("openapi")) return false;
  return true;
}

function computeQuantiles(bucket: Map<number, number>): ApiServerLatencyQuantiles {
  const sorted = [...bucket.entries()]
    .filter(([le]) => Number.isFinite(le))
    .sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return {};

  const total = sorted[sorted.length - 1][1];
  if (!Number.isFinite(total) || total <= 0) return {};

  const pickQuantile = (quantile: number): number | undefined => {
    const target = total * quantile;
    for (const [le, count] of sorted) {
      if (count >= target) return le;
    }
    return sorted[sorted.length - 1][0];
  };

  return {
    p50: pickQuantile(0.5),
    p95: pickQuantile(0.95),
    p99: pickQuantile(0.99),
  };
}

function buildSummary(
  overall: ApiServerLatencyQuantiles,
  groups: ApiServerLatencyGroup[],
  errorMessage?: string,
): { status: ApiServerLatencyStatus; warnings: string[]; message?: string } {
  const warnings: string[] = [];
  if (errorMessage) {
    return { status: "unknown", warnings: [errorMessage], message: "Latency metrics unavailable." };
  }

  const overallP99 = overall.p99;
  let status: ApiServerLatencyStatus = "unknown";
  if (overallP99 !== undefined) {
    status = "ok";
    if (overallP99 >= DEFAULT_CRITICAL_SECONDS) {
      status = "critical";
      warnings.push("API server p99 latency is above critical threshold.");
    } else if (overallP99 >= DEFAULT_WARN_SECONDS) {
      status = "warning";
      warnings.push("API server p99 latency is above warning threshold.");
    }
  }

  for (const group of groups) {
    if (!group.quantiles.p99) continue;
    const verb = group.verb?.toUpperCase();
    const warn = verb === "LIST" ? LIST_WARN_SECONDS : DEFAULT_WARN_SECONDS;
    const critical = verb === "LIST" ? LIST_CRITICAL_SECONDS : DEFAULT_CRITICAL_SECONDS;
    if (group.quantiles.p99 >= critical) {
      status = "critical";
      warnings.push(
        `High latency detected for ${verb ?? "UNKNOWN"} ${group.resource ?? "resource"}.`,
      );
    } else if (group.quantiles.p99 >= warn && status !== "critical") {
      status = "warning";
      warnings.push(
        `Elevated latency detected for ${verb ?? "UNKNOWN"} ${group.resource ?? "resource"}.`,
      );
    }
  }

  const message =
    overallP99 !== undefined
      ? `API Server latency p99 = ${overallP99.toFixed(2)} s`
      : "No latency data.";

  return { status, warnings, message };
}

function parseLatencyMetrics(output: string): {
  overall: ApiServerLatencyQuantiles;
  groups: ApiServerLatencyGroup[];
} {
  const buckets: BucketMap = new Map();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parsed = parseMetricLine(trimmed);
    if (!parsed) continue;
    if (parsed.name !== "apiserver_request_duration_seconds_bucket") continue;
    if (!isRelevantLatencyMetric(parsed.labels)) continue;
    const le = toNumber(parsed.labels.le);
    if (le === undefined) continue;

    addBucket(buckets, { le }, parsed.value);
    addBucket(
      buckets,
      {
        verb: parsed.labels.verb,
        resource: parsed.labels.resource || parsed.labels.resource_subresource,
        le,
      },
      parsed.value,
    );
  }

  const overall = computeQuantiles(buckets.get("all|all") ?? new Map<number, number>());
  const groups: ApiServerLatencyGroup[] = [];

  for (const [key, bucket] of buckets.entries()) {
    if (key === "all|all") continue;
    const [verb, resource] = key.split("|");
    const quantiles = computeQuantiles(bucket);
    if (!quantiles.p99) continue;
    groups.push({
      verb: verb === "all" ? undefined : verb,
      resource: resource === "all" ? undefined : resource,
      quantiles,
    });
  }

  groups.sort((a, b) => (b.quantiles.p99 ?? 0) - (a.quantiles.p99 ?? 0));

  return { overall, groups: groups.slice(0, MAX_GROUPS) };
}

export async function checkApiServerLatency(
  clusterId: string,
  options?: { force?: boolean },
): Promise<ApiServerLatencyReport> {
  const cached = cachedLatency.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let overall: ApiServerLatencyQuantiles = {};
  let groups: ApiServerLatencyGroup[] = [];

  try {
    const result = await fetchApiserverMetrics(clusterId, {
      force: options?.force,
      cacheTtlMs: CACHE_MS,
      requestTimeout: REQUEST_TIMEOUT,
    });
    if (result.error) {
      errorMessage = result.error || "Failed to fetch API server latency metrics.";
      await logError(`API server latency fetch failed: ${errorMessage}`);
    } else {
      const parsed = parseLatencyMetrics(result.output);
      overall = parsed.overall;
      groups = parsed.groups;
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to fetch API server latency metrics.";
    await logError(`API server latency fetch failed: ${errorMessage}`);
  }

  const summary = buildSummary(overall, groups, errorMessage);
  const report: ApiServerLatencyReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    overall,
    groups,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedLatency.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
