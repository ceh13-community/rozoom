import * as Sentry from "@sentry/sveltekit";
import { telemetryEventBus } from "$shared/lib/telemetry-event-bus";

export type WatcherTelemetryEventName =
  | "session_start"
  | "session_stop"
  | "list_success"
  | "watch_event"
  | "watch_relist"
  | "retry_scheduled"
  | "fallback_enabled"
  | "path_skipped"
  | "transport_error"
  | "logic_error";

export type WatcherHealthSnapshot = {
  activeSessions: number;
  activeApiSessions: number;
  fallbackSessions: number;
  retryScheduledCount: number;
  relistCount: number;
  transportErrorCount: number;
  pathSkippedCount: number;
  logicErrorCount: number;
  lastEventAt: number | null;
};

export type WatcherTelemetrySummary = WatcherHealthSnapshot & {
  sampleSize: number;
};

export type WatcherTelemetryClusterRow = {
  clusterId: string;
  activeSessions: number;
  fallbackCount: number;
  retryCount: number;
  relistCount: number;
  transportErrorCount: number;
  logicErrorCount: number;
  lastEventAt: number | null;
  lastTransport: string | null;
  lastKind: string | null;
};

const watcherHealth: WatcherHealthSnapshot = {
  activeSessions: 0,
  activeApiSessions: 0,
  fallbackSessions: 0,
  retryScheduledCount: 0,
  relistCount: 0,
  transportErrorCount: 0,
  pathSkippedCount: 0,
  logicErrorCount: 0,
  lastEventAt: null,
};

function emit(
  name: WatcherTelemetryEventName,
  payload: Record<string, unknown>,
  options?: { sendToSentry?: boolean },
) {
  const at = Date.now();
  watcherHealth.lastEventAt = at;
  telemetryEventBus.emit({
    source: "watcher",
    name,
    at,
    payload,
  });

  if (options?.sendToSentry) {
    Sentry.captureException(
      new Error(typeof payload.error === "string" ? payload.error : `watcher:${name}`),
      {
        tags: {
          source: "watcher",
          event: name,
        },
        extra: payload,
      },
    );
  }
}

export function trackWatcherSessionStart(payload: Record<string, unknown>) {
  watcherHealth.activeSessions += 1;
  watcherHealth.activeApiSessions += 1;
  emit("session_start", payload);
}

export function trackWatcherSessionStop(payload: Record<string, unknown>) {
  watcherHealth.activeSessions = Math.max(0, watcherHealth.activeSessions - 1);
  watcherHealth.activeApiSessions = Math.max(0, watcherHealth.activeApiSessions - 1);
  emit("session_stop", payload);
}

export function trackWatcherListSuccess(payload: Record<string, unknown>) {
  emit("list_success", payload);
}

export function trackWatcherEvent(payload: Record<string, unknown>) {
  emit("watch_event", payload);
}

export function trackWatcherRelist(payload: Record<string, unknown>) {
  watcherHealth.relistCount += 1;
  emit("watch_relist", payload);
}

export function trackWatcherRetry(payload: Record<string, unknown>) {
  watcherHealth.retryScheduledCount += 1;
  emit("retry_scheduled", payload);
}

export function trackWatcherFallback(payload: Record<string, unknown>) {
  watcherHealth.fallbackSessions += 1;
  emit("fallback_enabled", payload);
}

export function trackWatcherPathSkipped(payload: Record<string, unknown>) {
  watcherHealth.pathSkippedCount += 1;
  emit("path_skipped", payload);
}

export function trackWatcherTransportError(payload: Record<string, unknown>) {
  watcherHealth.transportErrorCount += 1;
  emit("transport_error", payload);
}

export function trackWatcherLogicError(payload: Record<string, unknown>) {
  watcherHealth.logicErrorCount += 1;
  emit("logic_error", payload, { sendToSentry: true });
}

export function getWatcherHealthSnapshot(): WatcherHealthSnapshot {
  return { ...watcherHealth };
}

export function listWatcherTelemetryEvents() {
  return telemetryEventBus.list().filter((event) => event.source === "watcher");
}

export function getWatcherTelemetrySummary(): WatcherTelemetrySummary {
  return {
    ...getWatcherHealthSnapshot(),
    sampleSize: listWatcherTelemetryEvents().length,
  };
}

export function listWatcherTelemetryClusterRows(): WatcherTelemetryClusterRow[] {
  const rows = new Map<string, WatcherTelemetryClusterRow>();

  for (const event of listWatcherTelemetryEvents()) {
    const clusterId =
      typeof event.payload?.clusterId === "string" && event.payload.clusterId
        ? event.payload.clusterId
        : "unknown";
    const row = rows.get(clusterId) ?? {
      clusterId,
      activeSessions: 0,
      fallbackCount: 0,
      retryCount: 0,
      relistCount: 0,
      transportErrorCount: 0,
      logicErrorCount: 0,
      lastEventAt: null,
      lastTransport: null,
      lastKind: null,
    };

    row.lastEventAt = event.at;
    row.lastTransport =
      typeof event.payload?.transport === "string" ? event.payload.transport : row.lastTransport;
    row.lastKind = typeof event.payload?.kind === "string" ? event.payload.kind : row.lastKind;

    if (event.name === "session_start") {
      row.activeSessions += 1;
    } else if (event.name === "session_stop") {
      row.activeSessions = Math.max(0, row.activeSessions - 1);
    } else if (event.name === "fallback_enabled") {
      row.fallbackCount += 1;
    } else if (event.name === "retry_scheduled") {
      row.retryCount += 1;
    } else if (event.name === "watch_relist") {
      row.relistCount += 1;
    } else if (event.name === "transport_error") {
      row.transportErrorCount += 1;
    } else if (event.name === "logic_error") {
      row.logicErrorCount += 1;
    }

    rows.set(clusterId, row);
  }

  return [...rows.values()].sort((left, right) => {
    const rightErrors = right.transportErrorCount + right.logicErrorCount + right.fallbackCount;
    const leftErrors = left.transportErrorCount + left.logicErrorCount + left.fallbackCount;
    if (rightErrors !== leftErrors) return rightErrors - leftErrors;
    return left.clusterId.localeCompare(right.clusterId);
  });
}

export function resetWatcherTelemetry() {
  watcherHealth.activeSessions = 0;
  watcherHealth.activeApiSessions = 0;
  watcherHealth.fallbackSessions = 0;
  watcherHealth.retryScheduledCount = 0;
  watcherHealth.relistCount = 0;
  watcherHealth.transportErrorCount = 0;
  watcherHealth.pathSkippedCount = 0;
  watcherHealth.logicErrorCount = 0;
  watcherHealth.lastEventAt = null;
  telemetryEventBus.clearBySource("watcher");
}
