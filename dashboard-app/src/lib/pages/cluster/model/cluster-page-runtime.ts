import {
  listWatcherTelemetryClusterRows,
  getWatcherTelemetrySummary,
  stopNodesHealthPolling,
} from "$features/check-health";
import { stopGlobalWatcher } from "$features/check-health/model/watchers";
import { stopMetricsSourcesPolling } from "$features/metrics-sources";
import { stopBackupAuditPolling } from "$features/backup-audit";
import { stopVersionAuditPolling } from "$features/version-audit";
import { stopDeprecationScanPolling } from "$features/deprecation-scan";
import { stopAlertHubPolling } from "$features/alerts-hub";
import { stopArmorHubPolling } from "$features/armor-hub";
import { stopComplianceHubPolling } from "$features/compliance-hub";
import { listWorkloadEvents } from "$features/workloads-management";
import { listPortForwardTelemetryEvents } from "$shared/lib/port-forward-telemetry";
import {
  isDegradedMetricsProbeError as isKnownMetricsProbeError,
  isOptionalCapabilityError as isKnownOptionalCapabilityError,
} from "$shared/lib/runtime-probe-errors";
import { telemetryEventBus, type TelemetryEvent } from "$shared/lib/telemetry-event-bus";

type WorkloadEvent = ReturnType<typeof listWorkloadEvents>[number];
type PortForwardTelemetryEvent = ReturnType<typeof listPortForwardTelemetryEvents>[number];

export type ClusterRequestInspectorRow = {
  id: string;
  at: number;
  source: "workload" | "watcher" | "port-forward";
  title: string;
  detail: string;
  tone: "default" | "muted" | "warn" | "error";
};

export type ClusterRequestInspectorSummary = {
  sampleSize: number;
  cacheEvents: number;
  degradedEvents: number;
  lastEventAt: number | null;
};

export type AdaptiveConnectivityState = {
  active: boolean;
  reason: string;
  recommendedSensitivity: "normal" | "slow" | "unstable";
};

export type ClusterTrustBannerModel = {
  tone: string;
  title: string;
  detail: string;
} | null;

const ADAPTIVE_CONNECTIVITY_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? null;
}

export function buildWorkloadTelemetrySummary(events: WorkloadEvent[]) {
  const recent = events.slice(-500);
  const cacheHits = recent.filter((event) => event.name === "workloads.cache_hit").length;
  const staleHits = recent.filter((event) => event.name === "workloads.cache_stale_hit").length;
  const refreshDurations = recent
    .filter((event) => event.name === "workloads.refresh_duration")
    .map((event) => event.payload?.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const schedulerWaitDurations = recent
    .filter((event) => event.name === "workloads.scheduler_wait_ms")
    .map((event) => event.payload?.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const viewRenderDurations = recent
    .filter((event) => event.name === "workloads.view_render_ms")
    .map((event) => event.payload?.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    sampleSize: recent.length,
    cacheHits,
    staleHits,
    refreshP50: percentile(refreshDurations, 0.5),
    refreshP95: percentile(refreshDurations, 0.95),
    refreshP99: percentile(refreshDurations, 0.99),
    schedulerWaitP50: percentile(schedulerWaitDurations, 0.5),
    schedulerWaitP95: percentile(schedulerWaitDurations, 0.95),
    schedulerWaitP99: percentile(schedulerWaitDurations, 0.99),
    viewRenderP50: percentile(viewRenderDurations, 0.5),
    viewRenderP95: percentile(viewRenderDurations, 0.95),
    viewRenderP99: percentile(viewRenderDurations, 0.99),
    lastEventAt: recent.at(-1)?.at ?? null,
  };
}

export function buildWorkloadPerfRows(events: WorkloadEvent[]) {
  const recent = events.slice(-1200);
  const byWorkload = new Map<
    string,
    { refresh: number[]; render: number[]; wait: number[]; cacheHit: number; staleHit: number }
  >();

  for (const event of recent) {
    const workload =
      (typeof event.payload?.workloadType === "string" && event.payload.workloadType) ||
      (typeof event.payload?.workload === "string" && event.payload.workload) ||
      "unknown";
    const bucket = byWorkload.get(workload) ?? {
      refresh: [],
      render: [],
      wait: [],
      cacheHit: 0,
      staleHit: 0,
    };
    const duration = event.payload?.durationMs;
    if (event.name === "workloads.refresh_duration" && typeof duration === "number") {
      bucket.refresh.push(duration);
    } else if (event.name === "workloads.view_render_ms" && typeof duration === "number") {
      bucket.render.push(duration);
    } else if (event.name === "workloads.scheduler_wait_ms" && typeof duration === "number") {
      bucket.wait.push(duration);
    } else if (event.name === "workloads.cache_hit") {
      bucket.cacheHit += 1;
    } else if (event.name === "workloads.cache_stale_hit") {
      bucket.staleHit += 1;
    }
    byWorkload.set(workload, bucket);
  }

  return [...byWorkload.entries()]
    .map(([workload, stats]) => ({
      workload,
      refreshP50: percentile(stats.refresh, 0.5),
      refreshP95: percentile(stats.refresh, 0.95),
      refreshP99: percentile(stats.refresh, 0.99),
      renderP50: percentile(stats.render, 0.5),
      renderP95: percentile(stats.render, 0.95),
      renderP99: percentile(stats.render, 0.99),
      waitP50: percentile(stats.wait, 0.5),
      waitP95: percentile(stats.wait, 0.95),
      waitP99: percentile(stats.wait, 0.99),
      cacheHits: stats.cacheHit,
      staleHits: stats.staleHit,
    }))
    .sort((a, b) => (b.refreshP95 ?? 0) - (a.refreshP95 ?? 0))
    .slice(0, 12);
}

export function readWatcherTelemetrySummary() {
  return getWatcherTelemetrySummary();
}

export function readWatcherTelemetryRows() {
  return listWatcherTelemetryClusterRows().slice(0, 12);
}

function payloadString(event: TelemetryEvent, key: string): string | null {
  const value = event.payload?.[key];
  return typeof value === "string" && value ? value : null;
}

function payloadNumber(event: TelemetryEvent, key: string): number | null {
  const value = event.payload?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isClusterWorkloadEvent(event: WorkloadEvent, clusterId: string) {
  return payloadString(event as TelemetryEvent, "clusterUuid") === clusterId;
}

function isClusterWatcherEvent(event: TelemetryEvent, clusterId: string) {
  return event.source === "watcher" && payloadString(event, "clusterId") === clusterId;
}

function isClusterPortForwardEvent(event: PortForwardTelemetryEvent, clusterId: string) {
  return payloadString(event, "clusterId") === clusterId;
}

function formatWorkloadInspectorRow(event: WorkloadEvent): ClusterRequestInspectorRow {
  const workload =
    payloadString(event as TelemetryEvent, "workloadType") ??
    payloadString(event as TelemetryEvent, "workload") ??
    "unknown";
  const namespace = payloadString(event as TelemetryEvent, "namespace");
  const durationMs = payloadNumber(event as TelemetryEvent, "durationMs");

  if (event.name === "workloads.cache_hit") {
    return {
      id: `workload:${event.at}:${event.name}`,
      at: event.at,
      source: "workload",
      title: `${workload} cache hit`,
      detail: namespace
        ? `Serving cached snapshot for namespace ${namespace}.`
        : "Serving cached snapshot.",
      tone: "muted",
    };
  }

  if (event.name === "workloads.cache_stale_hit") {
    return {
      id: `workload:${event.at}:${event.name}`,
      at: event.at,
      source: "workload",
      title: `${workload} stale cache`,
      detail: namespace
        ? `Showing stale data for namespace ${namespace} while refresh catches up.`
        : "Showing stale data while refresh catches up.",
      tone: "warn",
    };
  }

  if (event.name === "workloads.request_deduped") {
    return {
      id: `workload:${event.at}:${event.name}`,
      at: event.at,
      source: "workload",
      title: `${workload} request deduped`,
      detail:
        "An identical request was already in flight, so the UI reused it instead of issuing another call.",
      tone: "muted",
    };
  }

  if (event.name === "workloads.scheduler_wait_ms") {
    return {
      id: `workload:${event.at}:${event.name}`,
      at: event.at,
      source: "workload",
      title: `${workload} request queued`,
      detail:
        durationMs !== null
          ? `Scheduler waited ${durationMs}ms before issuing the refresh.`
          : "Request waited in the scheduler queue.",
      tone: "default",
    };
  }

  if (event.name === "workloads.refresh_duration") {
    const ok = event.payload?.ok !== false;
    return {
      id: `workload:${event.at}:${event.name}`,
      at: event.at,
      source: "workload",
      title: ok ? `${workload} refresh complete` : `${workload} refresh failed`,
      detail:
        durationMs !== null
          ? `${ok ? "Completed" : "Failed"} after ${durationMs}ms${namespace ? ` for namespace ${namespace}` : ""}.`
          : ok
            ? "Refresh completed."
            : "Refresh failed.",
      tone: ok ? "default" : "error",
    };
  }

  return {
    id: `workload:${event.at}:${event.name}`,
    at: event.at,
    source: "workload",
    title: `${workload} ${event.name.replaceAll(".", " ")}`,
    detail: namespace ? `Namespace ${namespace}.` : "Workload telemetry event.",
    tone: "default",
  };
}

function formatWatcherInspectorRow(event: TelemetryEvent): ClusterRequestInspectorRow {
  const kind = payloadString(event, "kind") ?? "resource";
  const transport = payloadString(event, "transport");
  const error = payloadString(event, "error");
  const path = payloadString(event, "path");
  const backoffMs = payloadNumber(event, "backoffMs");

  if (event.name === "fallback_enabled") {
    return {
      id: `watcher:${event.at}:${event.name}`,
      at: event.at,
      source: "watcher",
      title: `${kind} watcher fallback`,
      detail: "Watch mode degraded and fell back to safer list/poll behavior.",
      tone: "warn",
    };
  }

  if (event.name === "retry_scheduled") {
    return {
      id: `watcher:${event.at}:${event.name}`,
      at: event.at,
      source: "watcher",
      title: `${kind} watcher retry`,
      detail:
        backoffMs !== null
          ? `Retry scheduled after ${backoffMs}ms backoff.`
          : "Retry scheduled after watcher disruption.",
      tone: "warn",
    };
  }

  if (event.name === "transport_error" || event.name === "logic_error") {
    return {
      id: `watcher:${event.at}:${event.name}`,
      at: event.at,
      source: "watcher",
      title: `${kind} watcher ${event.name === "logic_error" ? "logic error" : "transport error"}`,
      detail: error ?? path ?? transport ?? "Watcher reported an error condition.",
      tone: "error",
    };
  }

  if (event.name === "watch_relist") {
    return {
      id: `watcher:${event.at}:${event.name}`,
      at: event.at,
      source: "watcher",
      title: `${kind} watcher relist`,
      detail: transport
        ? `Watcher re-established state via ${transport}.`
        : "Watcher rebuilt state from a list call.",
      tone: "default",
    };
  }

  return {
    id: `watcher:${event.at}:${event.name}`,
    at: event.at,
    source: "watcher",
    title: `${kind} watcher ${event.name.replaceAll("_", " ")}`,
    detail: transport ?? path ?? "Watcher telemetry event.",
    tone: "default",
  };
}

function formatPortForwardInspectorRow(
  event: PortForwardTelemetryEvent,
): ClusterRequestInspectorRow {
  const resource = payloadString(event, "resource") ?? "port-forward";
  const namespace = payloadString(event, "namespace");
  const reason = payloadString(event, "reason");
  const success = event.payload?.success === true;

  if (event.name === "start_attempt") {
    return {
      id: `port-forward:${event.at}:${event.name}`,
      at: event.at,
      source: "port-forward",
      title: `${resource} port-forward start`,
      detail: namespace
        ? `Starting port-forward in namespace ${namespace}.`
        : "Starting port-forward.",
      tone: "default",
    };
  }

  if (event.name === "start_result") {
    return {
      id: `port-forward:${event.at}:${event.name}`,
      at: event.at,
      source: "port-forward",
      title: success ? `${resource} port-forward ready` : `${resource} port-forward failed`,
      detail: success
        ? "Port-forward established successfully."
        : (reason ?? "Port-forward failed to start."),
      tone: success ? "default" : "error",
    };
  }

  if (event.name === "stop_result") {
    return {
      id: `port-forward:${event.at}:${event.name}`,
      at: event.at,
      source: "port-forward",
      title: success ? `${resource} port-forward stopped` : `${resource} port-forward stop failed`,
      detail: success ? "Port-forward closed cleanly." : "Port-forward failed to stop cleanly.",
      tone: success ? "muted" : "error",
    };
  }

  return {
    id: `port-forward:${event.at}:${event.name}`,
    at: event.at,
    source: "port-forward",
    title: `${resource} port-forward ${event.name.replaceAll("_", " ")}`,
    detail: namespace ? `Namespace ${namespace}.` : "Port-forward telemetry event.",
    tone: "default",
  };
}

function normalizeAdaptiveDetail(row: ClusterRequestInspectorRow) {
  return `${row.title} ${row.detail}`.toLowerCase();
}

function isOptionalCapabilityError(row: ClusterRequestInspectorRow) {
  return isKnownOptionalCapabilityError(normalizeAdaptiveDetail(row));
}

function isMetricsDegradedError(row: ClusterRequestInspectorRow) {
  return isKnownMetricsProbeError(normalizeAdaptiveDetail(row));
}

function isRelevantAdaptiveRow(row: ClusterRequestInspectorRow) {
  if (row.source === "watcher" && (isOptionalCapabilityError(row) || isMetricsDegradedError(row))) {
    return false;
  }
  return (
    (row.source === "watcher" && (row.tone === "error" || row.tone === "warn")) ||
    (row.source === "port-forward" && row.tone === "error")
  );
}

export function buildClusterRequestInspector(clusterId: string, limit = 18) {
  const workloadRows = listWorkloadEvents()
    .filter((event) => isClusterWorkloadEvent(event, clusterId))
    .map((event) => ({ event, row: formatWorkloadInspectorRow(event) }));
  const watcherRows = telemetryEventBus
    .list()
    .filter((event) => isClusterWatcherEvent(event, clusterId))
    .map((event) => ({ event, row: formatWatcherInspectorRow(event) }));
  const portForwardRows = listPortForwardTelemetryEvents()
    .filter((event) => isClusterPortForwardEvent(event, clusterId))
    .map((event) => ({ event, row: formatPortForwardInspectorRow(event) }));

  const merged = [...workloadRows, ...watcherRows, ...portForwardRows]
    .sort((left, right) => right.row.at - left.row.at)
    .slice(0, limit);

  const summary: ClusterRequestInspectorSummary = {
    sampleSize: merged.length,
    cacheEvents: merged.filter(
      ({ event }) =>
        event.name === "workloads.cache_hit" || event.name === "workloads.cache_stale_hit",
    ).length,
    degradedEvents: merged.filter(({ row }) => row.tone === "warn" || row.tone === "error").length,
    lastEventAt: merged[0]?.row.at ?? null,
  };

  return {
    summary,
    rows: merged.map(({ row }) => row),
  };
}

export function buildAdaptiveConnectivityState(clusterId: string): AdaptiveConnectivityState {
  const inspector = buildClusterRequestInspector(clusterId, 24);
  const relevantRows = inspector.rows.filter(isRelevantAdaptiveRow);
  const recentRows = relevantRows.slice(0, 8);
  const lastRelevantAt = recentRows[0]?.at ?? null;
  const recentAgeMs = lastRelevantAt ? Date.now() - lastRelevantAt : Number.POSITIVE_INFINITY;
  const rowsWithinRecoveryWindow = recentRows.filter(
    (row) => Date.now() - row.at <= ADAPTIVE_CONNECTIVITY_RECOVERY_WINDOW_MS,
  );
  const hasWatcherError = rowsWithinRecoveryWindow.some(
    (row) => row.source === "watcher" && row.tone === "error",
  );
  const hasWatcherFallback = rowsWithinRecoveryWindow.some(
    (row) => row.source === "watcher" && row.tone === "warn",
  );
  const hasPortForwardError = rowsWithinRecoveryWindow.some(
    (row) => row.source === "port-forward" && row.tone === "error",
  );
  const active =
    recentAgeMs <= ADAPTIVE_CONNECTIVITY_RECOVERY_WINDOW_MS && rowsWithinRecoveryWindow.length >= 2;

  if (hasWatcherError) {
    return {
      active,
      reason: active
        ? "Recent watcher transport or logic errors moved this cluster into adaptive degraded mode."
        : "Watcher errors were observed recently, but not enough to keep degraded mode active.",
      recommendedSensitivity: "unstable",
    };
  }

  if (hasWatcherFallback || hasPortForwardError) {
    return {
      active,
      reason: active
        ? "Repeated fallback or debug transport failures reduced runtime aggressiveness automatically."
        : "Fallback signals were observed recently, but adaptive degraded mode is not currently active.",
      recommendedSensitivity: "slow",
    };
  }

  const hadRecentIgnoredNoise = inspector.rows.some(
    (row) =>
      Date.now() - row.at <= ADAPTIVE_CONNECTIVITY_RECOVERY_WINDOW_MS &&
      (isOptionalCapabilityError(row) || isMetricsDegradedError(row)),
  );

  if (hadRecentIgnoredNoise) {
    return {
      active: false,
      reason:
        "Optional capability gaps or metrics endpoint issues were observed, but they do not require cluster-wide adaptive degraded mode.",
      recommendedSensitivity: "normal",
    };
  }

  return {
    active: false,
    reason:
      recentRows.length === 0
        ? "No recent degraded runtime signals detected."
        : "Adaptive degraded mode recovered after a quiet period without watcher transport or logic failures.",
    recommendedSensitivity: "normal",
  };
}

export function buildClusterTrustBannerModel(options: {
  adaptiveConnectivityState: AdaptiveConnectivityState;
  clusterRuntimeState: string;
  clusterRuntimeProfileSummary: string;
  workloadCacheBanner: string | null;
}): ClusterTrustBannerModel {
  const {
    adaptiveConnectivityState,
    clusterRuntimeState,
    clusterRuntimeProfileSummary,
    workloadCacheBanner,
  } = options;

  if (adaptiveConnectivityState.active || clusterRuntimeState === "degraded") {
    return {
      tone: "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100",
      title: "Cluster runtime is recovering",
      detail: `${adaptiveConnectivityState.reason} The current section may already be rendering normally, but cluster-wide runtime remains in a 5-minute recovery window after recent watcher failures. Active profile: ${clusterRuntimeProfileSummary}. Runtime budget is currently biased toward ${adaptiveConnectivityState.recommendedSensitivity} connectivity.`,
    };
  }

  if (workloadCacheBanner?.startsWith("Stale cache")) {
    return {
      tone: "border-sky-300/70 bg-sky-50 text-sky-950 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100",
      title: "Cluster is serving stale cached data",
      detail: `${workloadCacheBanner}. The UI is keeping the last successful snapshot visible while refresh catches up.`,
    };
  }

  return null;
}

export function resolveRelativeTickMs(lastUpdatedAt: number | null): number {
  if (!lastUpdatedAt) return 30_000;
  const ageSec = Math.max(0, (Date.now() - lastUpdatedAt) / 1000);
  if (ageSec < 20) return 2_000;
  if (ageSec < 120) return 10_000;
  if (ageSec < 600) return 20_000;
  return 30_000;
}

export function stopClusterDetailBackgroundPollers(clusterId: string | null | undefined) {
  if (!clusterId) return;
  stopGlobalWatcher(clusterId);
  stopNodesHealthPolling(clusterId);
  stopMetricsSourcesPolling(clusterId);
  stopBackupAuditPolling(clusterId);
  stopVersionAuditPolling(clusterId);
  stopDeprecationScanPolling(clusterId);
  stopAlertHubPolling(clusterId);
  stopArmorHubPolling(clusterId);
  stopComplianceHubPolling(clusterId);
}
