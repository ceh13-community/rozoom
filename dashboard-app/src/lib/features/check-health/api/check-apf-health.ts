import { error as logError } from "@tauri-apps/plugin-log";
import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import type {
  ApfHealthReport,
  ApfHealthStatus,
  ApfMetricRate,
  ApfMetricSample,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT = "10s";
const QUEUE_WARNING_RATIO = 0.8;
const QUEUE_CRITICAL_RATIO = 0.9;
const WAIT_WARNING_SECONDS = 1;
const WAIT_CRITICAL_SECONDS = 5;

const cachedApf = new Map<string, { data: ApfHealthReport; fetchedAt: number }>();
const apfHistory = new Map<
  string,
  { capturedAt: number; totals: { rejected?: number; waitSum?: number; waitCount?: number } }
>();

type ApfTotals = {
  inQueueRequests?: number;
  nominalLimitSeats?: number;
  concurrencyLimit?: number;
  rejectedTotal?: number;
  waitDurationSum?: number;
  waitDurationCount?: number;
};

const METRIC_KEYS = new Set([
  "apiserver_flowcontrol_current_inqueue_requests",
  "apiserver_flowcontrol_nominal_limit_seats",
  "apiserver_flowcontrol_request_concurrency_limit",
  "apiserver_flowcontrol_rejected_requests_total",
  "apiserver_flowcontrol_request_wait_duration_seconds_sum",
  "apiserver_flowcontrol_request_wait_duration_seconds_count",
]);

function parseApfMetrics(output: string): ApfTotals | null {
  if (!output.trim()) return null;
  const totals: ApfTotals = {};
  let matched = false;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/,
    );
    if (!match) continue;
    const name = match[1];
    if (!METRIC_KEYS.has(name)) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;

    matched = true;
    switch (name) {
      case "apiserver_flowcontrol_current_inqueue_requests":
        totals.inQueueRequests = (totals.inQueueRequests ?? 0) + value;
        break;
      case "apiserver_flowcontrol_nominal_limit_seats":
        totals.nominalLimitSeats = (totals.nominalLimitSeats ?? 0) + value;
        break;
      case "apiserver_flowcontrol_request_concurrency_limit":
        totals.concurrencyLimit = (totals.concurrencyLimit ?? 0) + value;
        break;
      case "apiserver_flowcontrol_rejected_requests_total":
        totals.rejectedTotal = (totals.rejectedTotal ?? 0) + value;
        break;
      case "apiserver_flowcontrol_request_wait_duration_seconds_sum":
        totals.waitDurationSum = (totals.waitDurationSum ?? 0) + value;
        break;
      case "apiserver_flowcontrol_request_wait_duration_seconds_count":
        totals.waitDurationCount = (totals.waitDurationCount ?? 0) + value;
        break;
      default:
        break;
    }
  }

  return matched ? totals : null;
}

function buildMetricRates(clusterId: string, totals: ApfTotals | null): ApfMetricRate {
  if (!totals) return {};
  const now = Date.now();
  const previous = apfHistory.get(clusterId);
  apfHistory.set(clusterId, {
    capturedAt: now,
    totals: {
      rejected: totals.rejectedTotal,
      waitSum: totals.waitDurationSum,
      waitCount: totals.waitDurationCount,
    },
  });

  if (!previous?.capturedAt) return {};

  const minutes = (now - previous.capturedAt) / (1000 * 60);
  if (minutes <= 0) return {};

  const rates: ApfMetricRate = {};
  if (totals.rejectedTotal !== undefined && previous.totals.rejected !== undefined) {
    const delta = totals.rejectedTotal - previous.totals.rejected;
    if (delta >= 0) {
      rates.rejectedPerMinute = delta / minutes;
    }
  }
  if (
    totals.waitDurationSum !== undefined &&
    totals.waitDurationCount !== undefined &&
    previous.totals.waitSum !== undefined &&
    previous.totals.waitCount !== undefined
  ) {
    const deltaSum = totals.waitDurationSum - previous.totals.waitSum;
    const deltaCount = totals.waitDurationCount - previous.totals.waitCount;
    if (deltaSum >= 0 && deltaCount > 0) {
      rates.avgWaitSeconds = deltaSum / deltaCount;
    }
  }

  return rates;
}

function buildSummary(
  totals: ApfTotals | null,
  rates: ApfMetricRate,
  errorMessage?: string,
): { status: ApfHealthStatus; warnings: string[]; message?: string } {
  const warnings: string[] = [];
  let status: ApfHealthStatus = "unknown";

  if (errorMessage) {
    return { status: "unknown", warnings: [errorMessage], message: "APF metrics unavailable." };
  }

  if (!totals) {
    return { status: "unknown", warnings: ["No APF metrics found."], message: "No APF data." };
  }

  const limitSeats = totals.nominalLimitSeats ?? totals.concurrencyLimit;
  const queue = totals.inQueueRequests;
  if (queue !== undefined && limitSeats !== undefined && limitSeats > 0) {
    rates.queueUtilization = queue / limitSeats;
  }

  const messageParts: string[] = [];
  if (queue !== undefined && limitSeats !== undefined && limitSeats > 0) {
    const percent = Math.min(100, Math.max(0, (queue / limitSeats) * 100));
    messageParts.push(
      `APF queue ${queue.toFixed(0)}/${limitSeats.toFixed(0)} seats (${percent.toFixed(0)}%)`,
    );
  }
  if (rates.avgWaitSeconds !== undefined) {
    messageParts.push(`Avg wait ${rates.avgWaitSeconds.toFixed(2)}s`);
  }
  if (rates.rejectedPerMinute !== undefined) {
    messageParts.push(`Rejected ${rates.rejectedPerMinute.toFixed(2)}/min`);
  }

  const message = messageParts.join(" · ") || "APF metrics available.";

  if (rates.rejectedPerMinute !== undefined && rates.rejectedPerMinute > 0) {
    warnings.push("APF has rejected requests in the last interval.");
    status = "critical";
  }

  if (rates.avgWaitSeconds !== undefined) {
    if (rates.avgWaitSeconds >= WAIT_CRITICAL_SECONDS) {
      warnings.push("APF request wait time is above critical threshold.");
      status = "critical";
    } else if (rates.avgWaitSeconds >= WAIT_WARNING_SECONDS && status !== "critical") {
      warnings.push("APF request wait time is above warning threshold.");
      status = "warning";
    }
  }

  if (rates.queueUtilization !== undefined) {
    if (rates.queueUtilization >= QUEUE_CRITICAL_RATIO) {
      warnings.push("APF queue utilization is above critical threshold.");
      status = "critical";
    } else if (rates.queueUtilization >= QUEUE_WARNING_RATIO && status !== "critical") {
      warnings.push("APF queue utilization is above warning threshold.");
      status = "warning";
    }
  }

  if (status === "unknown") {
    status = warnings.length ? "warning" : "ok";
  }

  return { status, warnings, message };
}

export async function checkApfHealth(
  clusterId: string,
  options?: { force?: boolean },
): Promise<ApfHealthReport> {
  const cached = cachedApf.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let metrics: ApfMetricSample | null = null;

  try {
    const result = await fetchApiserverMetrics(clusterId, {
      force: options?.force,
      cacheTtlMs: CACHE_MS,
      requestTimeout: REQUEST_TIMEOUT,
    });
    if (result.error) {
      errorMessage = result.error || "Failed to fetch APF metrics.";
      await logError(`APF metrics fetch failed: ${errorMessage}`);
    } else {
      const totals = parseApfMetrics(result.output);
      metrics = totals
        ? {
            inQueueRequests: totals.inQueueRequests,
            nominalLimitSeats: totals.nominalLimitSeats,
            concurrencyLimit: totals.concurrencyLimit,
            rejectedTotal: totals.rejectedTotal,
            waitDurationSum: totals.waitDurationSum,
            waitDurationCount: totals.waitDurationCount,
            sampledAt: Date.now(),
          }
        : null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch APF metrics.";
    await logError(`APF metrics fetch failed: ${errorMessage}`);
  }

  const totals = metrics
    ? {
        inQueueRequests: metrics.inQueueRequests,
        nominalLimitSeats: metrics.nominalLimitSeats,
        concurrencyLimit: metrics.concurrencyLimit,
        rejectedTotal: metrics.rejectedTotal,
        waitDurationSum: metrics.waitDurationSum,
        waitDurationCount: metrics.waitDurationCount,
      }
    : null;
  const metricRates = buildMetricRates(clusterId, totals);
  const summary = buildSummary(totals, metricRates, errorMessage);

  const report: ApfHealthReport = {
    status: summary.status,
    summary: { ...summary, updatedAt: Date.now() },
    metrics,
    metricRates,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedApf.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
