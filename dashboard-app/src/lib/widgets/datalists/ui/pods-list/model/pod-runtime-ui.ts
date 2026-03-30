import type { PodListRow } from "./pod-row-adapter";

const TERMINAL_POD_STATUSES = new Set(["completed", "succeeded", "failed", "evicted"]);

export function shouldShowPodsCacheBanner(options: {
  hasCachedPods: boolean;
  snapshotRefreshState: "idle" | "loading" | "error";
  syncError: string | null;
  syncLoading: boolean;
}) {
  const { hasCachedPods, snapshotRefreshState, syncError, syncLoading } = options;
  if (!hasCachedPods) return false;
  return (
    snapshotRefreshState === "error" ||
    snapshotRefreshState === "loading" ||
    Boolean(syncError) ||
    syncLoading
  );
}

export function isPodLiveUsageEligible(row: PodListRow) {
  return !TERMINAL_POD_STATUSES.has(row.status.trim().toLowerCase());
}

export function buildPodMetricsSummary(options: {
  enrichedTableEnabled: boolean;
  metricsLoading: boolean;
  metricsError: string | null;
  rows: PodListRow[];
  metricsCoverageCount: number;
}) {
  const { enrichedTableEnabled, metricsLoading, metricsError, rows, metricsCoverageCount } =
    options;
  if (!enrichedTableEnabled) return "Live usage columns are hidden.";
  if (metricsLoading) return "Loading live CPU and memory usage…";
  if (metricsError) return "Live usage unavailable.";
  if (rows.length === 0) return "Live usage will appear when rows match the filter.";

  const eligibleCount = rows.filter(isPodLiveUsageEligible).length;
  if (eligibleCount === 0) {
    return "Terminal pods do not report live CPU and memory usage.";
  }

  const terminalCount = rows.length - eligibleCount;
  if (terminalCount === 0) {
    return `Live usage visible for ${metricsCoverageCount}/${eligibleCount} active pods in the current view.`;
  }

  const terminalLabel = terminalCount === 1 ? "pod does" : "pods do";
  return `Live usage visible for ${metricsCoverageCount}/${eligibleCount} active pods. ${terminalCount} terminal ${terminalLabel} not report live usage.`;
}
