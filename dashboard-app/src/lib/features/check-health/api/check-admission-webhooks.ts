import { error as logError } from "@tauri-apps/plugin-log";
import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import type {
  AdmissionWebhookItem,
  AdmissionWebhookLatency,
  AdmissionWebhookReport,
  AdmissionWebhookStatus,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT = "10s";
const LATENCY_WARNING_SECONDS = 5;
const LATENCY_CRITICAL_SECONDS = 10;

const cachedReports = new Map<string, { data: AdmissionWebhookReport; fetchedAt: number }>();
const history = new Map<
  string,
  {
    capturedAt: number;
    rejectTotals: Map<string, number>;
    failOpenTotals: Map<string, number>;
    overallReject?: number;
    overallFailOpen?: number;
  }
>();

type BucketMap = Map<string, Map<number, number>>;

type MetricTotals = {
  buckets: BucketMap;
  rejectTotals: Map<string, number>;
  failOpenTotals: Map<string, number>;
  overallReject?: number;
  overallFailOpen?: number;
};

type MetricRates = {
  rejectRates: Map<string, number>;
  failOpenRates: Map<string, number>;
  overallReject?: number;
  overallFailOpen?: number;
};

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

function groupKey(labels: Record<string, string>): string {
  const name = labels.name || "unknown";
  const operation = labels.operation || "all";
  const type = labels.type || "all";
  return `${name}|${operation}|${type}`;
}

function addBucket(buckets: BucketMap, key: string, le: number, value: number) {
  if (!buckets.has(key)) {
    buckets.set(key, new Map());
  }
  const bucket = buckets.get(key);
  if (!bucket) return;
  bucket.set(le, (bucket.get(le) ?? 0) + value);
}

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function computeQuantiles(bucket: Map<number, number>): AdmissionWebhookLatency {
  const sorted = [...bucket.entries()]
    .filter(([le]) => Number.isFinite(le))
    .sort((a, b) => a[0] - b[0]);
  if (!sorted.length) return {};

  const total = sorted[sorted.length - 1][1];
  if (!Number.isFinite(total) || total <= 0) return {};

  const pick = (quantile: number): number | undefined => {
    const target = total * quantile;
    for (const [le, count] of sorted) {
      if (count >= target) return le;
    }
    return sorted[sorted.length - 1][0];
  };

  return {
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
  };
}

function parseMetrics(output: string): MetricTotals | null {
  if (!output.trim()) return null;

  const buckets: BucketMap = new Map();
  const rejectTotals = new Map<string, number>();
  const failOpenTotals = new Map<string, number>();
  let matched = false;
  let overallReject = 0;
  let overallFailOpen = 0;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parsed = parseMetricLine(trimmed);
    if (!parsed) continue;
    const key = groupKey(parsed.labels);

    if (parsed.name === "apiserver_admission_webhook_admission_duration_seconds_bucket") {
      const le = toNumber(parsed.labels.le);
      if (le === undefined) continue;
      addBucket(buckets, key, le, parsed.value);
      addBucket(buckets, "all", le, parsed.value);
      matched = true;
      continue;
    }

    if (parsed.name === "apiserver_admission_webhook_rejection_count") {
      rejectTotals.set(key, (rejectTotals.get(key) ?? 0) + parsed.value);
      overallReject += parsed.value;
      matched = true;
      continue;
    }

    if (parsed.name === "apiserver_admission_webhook_fail_open_count") {
      failOpenTotals.set(key, (failOpenTotals.get(key) ?? 0) + parsed.value);
      overallFailOpen += parsed.value;
      matched = true;
      continue;
    }
  }

  if (!matched) return null;

  return {
    buckets,
    rejectTotals,
    failOpenTotals,
    overallReject,
    overallFailOpen,
  };
}

function computeRates(clusterId: string, totals: MetricTotals): MetricRates {
  const now = Date.now();
  const previous = history.get(clusterId);
  history.set(clusterId, {
    capturedAt: now,
    rejectTotals: totals.rejectTotals,
    failOpenTotals: totals.failOpenTotals,
    overallReject: totals.overallReject,
    overallFailOpen: totals.overallFailOpen,
  });

  if (!previous?.capturedAt) {
    return { rejectRates: new Map(), failOpenRates: new Map() };
  }

  const minutes = (now - previous.capturedAt) / (1000 * 60);
  if (minutes <= 0) {
    return { rejectRates: new Map(), failOpenRates: new Map() };
  }

  const rejectRates = new Map<string, number>();
  const failOpenRates = new Map<string, number>();

  for (const [key, value] of totals.rejectTotals.entries()) {
    const previousValue = previous.rejectTotals.get(key);
    if (previousValue === undefined) continue;
    const delta = value - previousValue;
    if (delta < 0) continue;
    rejectRates.set(key, delta / minutes);
  }

  for (const [key, value] of totals.failOpenTotals.entries()) {
    const previousValue = previous.failOpenTotals.get(key);
    if (previousValue === undefined) continue;
    const delta = value - previousValue;
    if (delta < 0) continue;
    failOpenRates.set(key, delta / minutes);
  }

  const overallReject =
    totals.overallReject !== undefined && previous.overallReject !== undefined
      ? Math.max(0, totals.overallReject - previous.overallReject) / minutes
      : undefined;
  const overallFailOpen =
    totals.overallFailOpen !== undefined && previous.overallFailOpen !== undefined
      ? Math.max(0, totals.overallFailOpen - previous.overallFailOpen) / minutes
      : undefined;

  return { rejectRates, failOpenRates, overallReject, overallFailOpen };
}

function buildItems(totals: MetricTotals, rates: MetricRates): AdmissionWebhookItem[] {
  const items: AdmissionWebhookItem[] = [];
  for (const [key, bucket] of totals.buckets.entries()) {
    if (key === "all") continue;
    const [name, operation, type] = key.split("|");
    const latency = computeQuantiles(bucket);
    items.push({
      name,
      operation: operation === "all" ? undefined : operation,
      type: type === "all" ? undefined : type,
      latency,
      rejectRate: rates.rejectRates.get(key),
      failOpenRate: rates.failOpenRates.get(key),
    });
  }

  items.sort((a, b) => {
    const failOpenDelta = (b.failOpenRate ?? 0) - (a.failOpenRate ?? 0);
    if (failOpenDelta !== 0) return failOpenDelta;
    return (b.latency.p99 ?? 0) - (a.latency.p99 ?? 0);
  });

  return items.slice(0, 8);
}

function buildSummary(
  totals: MetricTotals | null,
  rates: MetricRates,
  errorMessage?: string,
): { status: AdmissionWebhookStatus; warnings: string[]; message?: string } {
  if (errorMessage) {
    return {
      status: "unknown",
      warnings: [errorMessage],
      message: "Admission webhook metrics unavailable.",
    };
  }

  if (!totals) {
    return {
      status: "unknown",
      warnings: ["No admission webhook metrics found."],
      message: "No data.",
    };
  }

  const overallBucket = totals.buckets.get("all") ?? new Map<number, number>();
  const overallLatency = computeQuantiles(overallBucket);
  const warnings: string[] = [];
  let status: AdmissionWebhookStatus = "ok";

  if (rates.overallFailOpen !== undefined && rates.overallFailOpen > 0) {
    status = "critical";
    warnings.push("Fail-open events detected. Check webhook failurePolicy and timeoutSeconds.");
  }

  if (rates.overallReject !== undefined && rates.overallReject > 0 && status !== "critical") {
    status = "warning";
    warnings.push("Admission webhooks rejected requests in the last interval.");
  }

  if (overallLatency.p99 !== undefined) {
    if (overallLatency.p99 >= LATENCY_CRITICAL_SECONDS) {
      status = "critical";
      warnings.push("Admission webhook p99 latency is above critical threshold.");
    } else if (overallLatency.p99 >= LATENCY_WARNING_SECONDS && status !== "critical") {
      status = "warning";
      warnings.push("Admission webhook p99 latency is above warning threshold.");
    }
  }

  const messageParts: string[] = [];
  if (overallLatency.p99 !== undefined) {
    messageParts.push(`Admission webhooks p99 ${overallLatency.p99.toFixed(2)}s`);
  }
  if (rates.overallFailOpen !== undefined) {
    messageParts.push(`Fail-open ${rates.overallFailOpen.toFixed(2)}/min`);
  }
  if (rates.overallReject !== undefined) {
    messageParts.push(`Rejects ${rates.overallReject.toFixed(2)}/min`);
  }

  return {
    status,
    warnings,
    message: messageParts.join(" · ") || "Admission webhook metrics available.",
  };
}

export async function checkAdmissionWebhooks(
  clusterId: string,
  options?: { force?: boolean },
): Promise<AdmissionWebhookReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let totals: MetricTotals | null = null;

  try {
    const result = await fetchApiserverMetrics(clusterId, {
      force: options?.force,
      cacheTtlMs: CACHE_MS,
      requestTimeout: REQUEST_TIMEOUT,
    });
    if (result.error) {
      errorMessage = result.error || "Failed to fetch admission webhook metrics.";
      await logError(`Admission webhook metrics fetch failed: ${errorMessage}`);
    } else {
      totals = parseMetrics(result.output);
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to fetch admission webhook metrics.";
    await logError(`Admission webhook metrics fetch failed: ${errorMessage}`);
  }

  const emptyRates: MetricRates = { rejectRates: new Map(), failOpenRates: new Map() };
  const rates = totals ? computeRates(clusterId, totals) : emptyRates;
  const summary = buildSummary(totals, rates, errorMessage);
  const items = totals ? buildItems(totals, rates) : [];
  const overallBucket = totals?.buckets.get("all") ?? new Map<number, number>();
  const overallLatency = computeQuantiles(overallBucket);

  const report: AdmissionWebhookReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    items,
    totals: {
      rejectRate: rates.overallReject,
      failOpenRate: rates.overallFailOpen,
      p99Latency: overallLatency.p99,
    },
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
