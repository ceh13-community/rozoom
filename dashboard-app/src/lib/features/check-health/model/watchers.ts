/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { writable } from "svelte/store";
import { get } from "svelte/store";
import { collectClusterData, type CollectClusterDataMode } from "./collect-cluster-data";
import { clusterHealthChecks } from "./cache-store";
import { WATCHERS_INTERVAL } from "$entities/cluster";
import { clusterRuntimeBudget, clusterRuntimeContext } from "$shared/lib/cluster-runtime-manager";
import { getKubectlExecutionBudget } from "$shared/api/kubectl-proxy";
import {
  activeDashboardRoute,
  isDashboardRootRouteActive,
} from "$shared/lib/dashboard-route-activity";
import { reportWatcherRuntimeError } from "./stream-watchers/watcher-runtime-error";
import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
import { computeAdaptivePollingSeconds } from "$shared/lib/adaptive-polling";
import { globalLinterEnabled } from "./linter-preferences";

type ClusterState = {
  loading: boolean;
  error: string | null;
};

type WatcherUpdateKind = "refresh" | "diagnostics";

export const clusterStates = writable<Record<string, ClusterState>>({});
const watchers = new Map<string, ReturnType<typeof setInterval>>();
const watcherIntervals = new Map<string, number>();
const watcherCancellationVersions = new Map<string, number>();
const watcherErrorStreaks = new Map<string, number>();
const watcherLastDurationMs = new Map<string, number>();
const watcherLastSettledAt = new Map<string, number>();
const watcherLastStartedAt = new Map<string, number>();
const inFlight = new Set<string>();
const inFlightKinds = new Map<string, WatcherUpdateKind>();
const pendingClusters = new Set<string>();
const forcePendingClusters = new Set<string>();
const pendingClusterKinds = new Map<string, WatcherUpdateKind>();
let activeGlobalHealthUpdates = 0;
const IMMEDIATE_RESTART_COOLDOWN_MS = 30_000;

export type GlobalWatcherRuntimeSummary = {
  registeredWatchers: number;
  activeUpdates: number;
  activeRefreshUpdates: number;
  activeDiagnosticsUpdates: number;
  pendingUpdates: number;
  pendingRefreshUpdates: number;
  pendingDiagnosticsUpdates: number;
  inFlightClusters: number;
  maxConcurrentUpdates: number;
  maxConcurrentRefreshUpdates: number;
  maxConcurrentDiagnosticsUpdates: number;
};

export type GlobalWatcherRuntimeRow = {
  clusterId: string;
  loading: boolean;
  pending: boolean;
  pendingKind: WatcherUpdateKind | null;
  activeKind: WatcherUpdateKind | null;
  intervalMs: number | null;
  lastDurationMs: number | null;
  lastStartedAt: number | null;
  lastSettledAt: number | null;
};

const FIRST_SUCCESS_RETRY_MS = 30_000;

function computeNextWatcherDelayMs(clusterId: string) {
  // If the cluster never had a successful refresh, retry quickly (30s)
  // instead of waiting the full user-configured interval (e.g. 5 min)
  const hadSuccess = watcherLastDurationMs.has(clusterId);
  if (!hadSuccess) {
    return FIRST_SUCCESS_RETRY_MS;
  }

  const baseMs = watcherIntervals.get(clusterId) ?? WATCHERS_INTERVAL;
  const baseSeconds = Math.max(1, Math.round(baseMs / 1000));
  const durationMs = watcherLastDurationMs.get(clusterId) ?? 0;
  const durationSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const adaptiveSeconds = computeAdaptivePollingSeconds(baseSeconds, {
    isVisible: isPageVisible(),
    errorStreak: watcherErrorStreaks.get(clusterId) ?? 0,
    minSeconds: Math.max(baseSeconds, durationSeconds + 1),
    maxSeconds: Math.max(baseSeconds * 6, durationSeconds + 5),
  });
  return adaptiveSeconds * 1000;
}

function scheduleNextWatcher(clusterId: string) {
  if (!watcherIntervals.has(clusterId)) return;
  const existing = watchers.get(clusterId);
  if (existing) {
    clearTimeout(existing);
  }

  const delayMs = computeNextWatcherDelayMs(clusterId);
  void writeRuntimeDebugLog("watchers", "schedule_next", { clusterId, delayMs });
  const timer = setTimeout(() => {
    void updateClusterHealthChecks(clusterId).finally(() => {
      scheduleNextWatcher(clusterId);
    });
  }, delayMs);
  watchers.set(clusterId, timer);
}

function shouldRunWatcher(clusterId: string): boolean {
  if (!isDashboardRootRouteActive()) {
    return false;
  }
  const runtime = get(clusterRuntimeContext);
  if (!runtime.activeClusterId) {
    return runtime.diagnosticsEnabled;
  }
  return runtime.diagnosticsEnabled && runtime.activeClusterId === clusterId;
}

function resolveCollectionMode(
  clusterId: string,
  force: boolean,
  diagnostics = false,
  diagnosticsScope: "config" | "health" | "all" = "all",
): CollectClusterDataMode {
  const runtime = get(clusterRuntimeContext);
  if (isDashboardRootRouteActive() && !runtime.activeClusterId) {
    if (diagnostics) {
      if (diagnosticsScope === "config") return "dashboardConfigDiagnostics";
      if (diagnosticsScope === "health") return "dashboardHealthDiagnostics";
      return "dashboardDiagnostics";
    }
    return "dashboard";
  }
  if (force && isDashboardRootRouteActive()) {
    if (diagnostics) {
      if (diagnosticsScope === "config") return "dashboardConfigDiagnostics";
      if (diagnosticsScope === "health") return "dashboardHealthDiagnostics";
      return "dashboardDiagnostics";
    }
    return "dashboard";
  }
  return "full";
}

function getActiveUpdatesByKind(kind: WatcherUpdateKind) {
  let count = 0;
  for (const activeKind of inFlightKinds.values()) {
    if (activeKind === kind) count += 1;
  }
  return count;
}

function getPendingUpdatesByKind(kind: WatcherUpdateKind) {
  let count = 0;
  for (const pendingKind of pendingClusterKinds.values()) {
    if (pendingKind === kind) count += 1;
  }
  return count;
}

function getMaxConcurrentGlobalHealthUpdates(kind?: WatcherUpdateKind) {
  if (!isDashboardRootRouteActive()) {
    return 1;
  }

  const runtime = get(clusterRuntimeContext);
  if (runtime.activeClusterId) {
    return 1;
  }

  const budget = get(clusterRuntimeBudget);
  const execBudget = getKubectlExecutionBudget() ?? {
    maxConcurrentExecs: 6,
    maxConcurrentWatches: 2,
  };
  const dashboardRunExecCost = 2;
  const maxRunsFromExecBudget = Math.max(
    1,
    Math.floor(execBudget.maxConcurrentExecs / dashboardRunExecCost),
  );
  const totalLimit = Math.max(1, Math.min(budget.maxConcurrentConnections, maxRunsFromExecBudget));
  if (kind === "refresh") {
    return Math.max(1, Math.min(totalLimit, budget.maxConcurrentClusterRefreshes));
  }
  if (kind === "diagnostics") {
    return Math.max(0, Math.min(totalLimit, budget.maxConcurrentDiagnostics));
  }
  return totalLimit;
}

function canStartUpdateKind(kind: WatcherUpdateKind) {
  if (activeGlobalHealthUpdates >= getMaxConcurrentGlobalHealthUpdates()) {
    return false;
  }
  return getActiveUpdatesByKind(kind) < getMaxConcurrentGlobalHealthUpdates(kind);
}

function getWatcherCancellationVersion(clusterId: string): number {
  return watcherCancellationVersions.get(clusterId) ?? 0;
}

function bumpWatcherCancellationVersion(clusterId: string) {
  watcherCancellationVersions.set(clusterId, getWatcherCancellationVersion(clusterId) + 1);
}

function isPageVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

function drainPendingGlobalHealthUpdates() {
  if (activeGlobalHealthUpdates >= getMaxConcurrentGlobalHealthUpdates()) {
    return;
  }

  const snapshot = [...pendingClusters];
  for (const clusterId of snapshot) {
    if (activeGlobalHealthUpdates >= getMaxConcurrentGlobalHealthUpdates()) {
      break;
    }
    if (inFlight.has(clusterId)) {
      pendingClusters.delete(clusterId);
      forcePendingClusters.delete(clusterId);
      continue;
    }
    const force = forcePendingClusters.has(clusterId);
    if ((!force && !shouldRunWatcher(clusterId)) || !isPageVisible()) {
      void writeRuntimeDebugLog("watchers", "pending_skip", {
        clusterId,
        force,
        visible: isPageVisible(),
        activeGlobalHealthUpdates,
      });
      pendingClusters.delete(clusterId);
      forcePendingClusters.delete(clusterId);
      continue;
    }
    const kind = pendingClusterKinds.get(clusterId) ?? "refresh";
    if (!canStartUpdateKind(kind)) {
      continue;
    }
    pendingClusters.delete(clusterId);
    forcePendingClusters.delete(clusterId);
    pendingClusterKinds.delete(clusterId);
    void writeRuntimeDebugLog("watchers", "pending_drain", {
      clusterId,
      force,
      kind,
      activeGlobalHealthUpdates,
    });
    void updateClusterHealthChecks(clusterId, { force });
  }
}

export async function updateClusterHealthChecks(
  clusterId: string,
  options: {
    force?: boolean;
    diagnostics?: boolean;
    diagnosticsScope?: "config" | "health" | "all";
  } = {},
) {
  const force = options.force === true;
  const diagnostics = options.diagnostics === true;
  const updateKind: WatcherUpdateKind = diagnostics ? "diagnostics" : "refresh";
  const mode = resolveCollectionMode(
    clusterId,
    force,
    diagnostics,
    options.diagnosticsScope ?? "all",
  );

  if (!force && !shouldRunWatcher(clusterId)) {
    void writeRuntimeDebugLog("watchers", "skip_not_eligible", { clusterId, force });
    pendingClusters.delete(clusterId);
    forcePendingClusters.delete(clusterId);
    pendingClusterKinds.delete(clusterId);
    return;
  }
  if (!isPageVisible()) {
    void writeRuntimeDebugLog("watchers", "skip_hidden", { clusterId, force });
    pendingClusters.delete(clusterId);
    forcePendingClusters.delete(clusterId);
    pendingClusterKinds.delete(clusterId);
    return;
  }
  if (inFlight.has(clusterId)) {
    void writeRuntimeDebugLog("watchers", "skip_inflight", { clusterId, force });
    return;
  }
  if (!canStartUpdateKind(updateKind)) {
    pendingClusters.add(clusterId);
    pendingClusterKinds.set(clusterId, updateKind);
    if (force) {
      forcePendingClusters.add(clusterId);
    }
    void writeRuntimeDebugLog("watchers", "queued", {
      clusterId,
      force,
      kind: updateKind,
      queueSize: pendingClusters.size,
      activeGlobalHealthUpdates,
      limit: getMaxConcurrentGlobalHealthUpdates(updateKind),
    });
    return;
  }

  inFlight.add(clusterId);
  inFlightKinds.set(clusterId, updateKind);
  pendingClusters.delete(clusterId);
  forcePendingClusters.delete(clusterId);
  pendingClusterKinds.delete(clusterId);
  activeGlobalHealthUpdates += 1;
  const runVersion = getWatcherCancellationVersion(clusterId);
  watcherLastStartedAt.set(clusterId, Date.now());

  clusterStates.update((states) => ({
    ...states,
    [clusterId]: {
      ...(states[clusterId] ?? {}),
      loading: true,
      error: null,
    },
  }));

  let wasCancelled = false;

  try {
    const startedAt = Date.now();
    void writeRuntimeDebugLog("watchers", "run_start", {
      clusterId,
      force,
      kind: updateKind,
      mode,
      runVersion,
      activeGlobalHealthUpdates,
    });
    const result = await collectClusterData(clusterId, {
      shouldStop: () => getWatcherCancellationVersion(clusterId) !== runVersion,
      mode,
    });
    if (result === null) {
      wasCancelled = true;
      // Clear started timestamp so cooldown doesn't penalise a cancelled run.
      // The cluster never received data - it should be eligible for immediate retry.
      watcherLastStartedAt.delete(clusterId);
      void writeRuntimeDebugLog("watchers", "run_cancelled", {
        clusterId,
        force,
        kind: updateKind,
        mode,
        durationMs: Date.now() - startedAt,
      });
      clusterStates.update((states) => ({
        ...states,
        [clusterId]: { loading: false, error: null },
      }));
      return;
    }

    if (result && "errors" in result && result.errors && result.errors.length > 0) {
      const errorMessage = result.errors;
      throw new Error(`Cluster health check failed: ${errorMessage}`);
    }

    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
    watcherErrorStreaks.set(clusterId, 0);
    watcherLastDurationMs.set(clusterId, Date.now() - startedAt);
    void writeRuntimeDebugLog("watchers", "run_success", {
      clusterId,
      force,
      kind: updateKind,
      mode,
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : "An unknown error occurred while updating cluster health";

    clusterStates.update((states) => ({
      ...states,
      [clusterId]: {
        ...(states[clusterId] ?? {}),
        loading: false,
        error: errorMessage,
      },
    }));
    watcherErrorStreaks.set(clusterId, (watcherErrorStreaks.get(clusterId) ?? 0) + 1);
    reportWatcherRuntimeError({ clusterId, kind: "global-health" }, err);
    void writeRuntimeDebugLog("watchers", "run_error", {
      clusterId,
      force,
      kind: updateKind,
      mode,
      error: errorMessage,
    });
  } finally {
    inFlight.delete(clusterId);
    inFlightKinds.delete(clusterId);
    activeGlobalHealthUpdates = Math.max(0, activeGlobalHealthUpdates - 1);

    // Only update settled timestamp for completed runs (success or error).
    // Cancelled runs should not block the immediate-restart cooldown -
    // the cluster never got its data, so retrying quickly is desired.
    if (!wasCancelled) {
      watcherLastSettledAt.set(clusterId, Date.now());
    }

    void writeRuntimeDebugLog("watchers", "run_settled", {
      clusterId,
      force,
      kind: updateKind,
      mode,
      wasCancelled,
      activeGlobalHealthUpdates,
      pending: pendingClusters.size,
    });
    drainPendingGlobalHealthUpdates();
  }
}

export function startGlobalWatcher(
  clusterId: string,
  intervalMs: number = WATCHERS_INTERVAL,
  immediate = false,
) {
  if (!get(globalLinterEnabled)) return;
  watcherCancellationVersions.set(clusterId, getWatcherCancellationVersion(clusterId));
  const existingInterval = watcherIntervals.get(clusterId);
  if (watchers.has(clusterId) && existingInterval === intervalMs) {
    return;
  }

  if (watchers.has(clusterId)) {
    stopGlobalWatcher(clusterId);
  }

  if (!(clusterId in get(clusterStates))) {
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
  }

  const cachedCheck = get(clusterHealthChecks)[clusterId];
  const hasCachedSnapshot = Boolean(cachedCheck && !("errors" in cachedCheck));
  const shouldRunImmediate =
    immediate &&
    !hasCachedSnapshot &&
    !inFlight.has(clusterId) &&
    (!watcherLastStartedAt.has(clusterId) ||
      Date.now() - (watcherLastStartedAt.get(clusterId) ?? 0) >= IMMEDIATE_RESTART_COOLDOWN_MS) &&
    (!watcherLastSettledAt.has(clusterId) ||
      Date.now() - (watcherLastSettledAt.get(clusterId) ?? 0) >= IMMEDIATE_RESTART_COOLDOWN_MS);

  if (immediate && !shouldRunImmediate) {
    void writeRuntimeDebugLog("watchers", "skip_immediate_recent_activity", {
      clusterId,
      cooldownMs: IMMEDIATE_RESTART_COOLDOWN_MS,
      hasCachedSnapshot,
      inFlight: inFlight.has(clusterId),
      sinceStartedMs: watcherLastStartedAt.has(clusterId)
        ? Date.now() - (watcherLastStartedAt.get(clusterId) ?? 0)
        : null,
      sinceSettledMs: watcherLastSettledAt.has(clusterId)
        ? Date.now() - (watcherLastSettledAt.get(clusterId) ?? 0)
        : null,
    });
  }

  if (shouldRunImmediate) {
    void writeRuntimeDebugLog("watchers", "start_immediate", { clusterId, intervalMs });
    void updateClusterHealthChecks(clusterId);
  }
  watcherIntervals.set(clusterId, intervalMs);
  scheduleNextWatcher(clusterId);
}

export function stopGlobalWatcher(clusterId: string) {
  const hasTrackedState =
    watchers.has(clusterId) ||
    watcherIntervals.has(clusterId) ||
    pendingClusters.has(clusterId) ||
    forcePendingClusters.has(clusterId) ||
    inFlight.has(clusterId);
  if (!hasTrackedState) return;

  void writeRuntimeDebugLog("watchers", "stop", { clusterId });
  bumpWatcherCancellationVersion(clusterId);
  pendingClusters.delete(clusterId);
  forcePendingClusters.delete(clusterId);
  pendingClusterKinds.delete(clusterId);
  watcherErrorStreaks.delete(clusterId);
  watcherLastDurationMs.delete(clusterId);

  const interval = watchers.get(clusterId);

  if (interval) {
    clearInterval(interval);
    watchers.delete(clusterId);
    watcherIntervals.delete(clusterId);
  }

  clusterStates.update((states) => ({
    ...states,
    [clusterId]: { loading: false, error: null },
  }));
}

export function stopAllWatchers() {
  const hasTrackedState =
    watchers.size > 0 ||
    pendingClusters.size > 0 ||
    forcePendingClusters.size > 0 ||
    inFlight.size > 0;
  if (!hasTrackedState) {
    return;
  }
  void writeRuntimeDebugLog("watchers", "stop_all", { count: watchers.size });
  watchers.forEach((interval, clusterId) => {
    clearTimeout(interval);
    bumpWatcherCancellationVersion(clusterId);
    pendingClusters.delete(clusterId);
    forcePendingClusters.delete(clusterId);
    pendingClusterKinds.delete(clusterId);
    watcherErrorStreaks.delete(clusterId);
    watcherLastDurationMs.delete(clusterId);
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
  });
  watchers.clear();
  watcherIntervals.clear();
  watcherCancellationVersions.clear();
  watcherErrorStreaks.clear();
  watcherLastDurationMs.clear();
  watcherLastSettledAt.clear();
  watcherLastStartedAt.clear();
  pendingClusters.clear();
  forcePendingClusters.clear();
  pendingClusterKinds.clear();
  inFlight.clear();
  inFlightKinds.clear();
  activeGlobalHealthUpdates = 0;
}

export function getGlobalWatcherRuntimeSummary(): GlobalWatcherRuntimeSummary {
  return {
    registeredWatchers: watchers.size,
    activeUpdates: activeGlobalHealthUpdates,
    activeRefreshUpdates: getActiveUpdatesByKind("refresh"),
    activeDiagnosticsUpdates: getActiveUpdatesByKind("diagnostics"),
    pendingUpdates: pendingClusters.size,
    pendingRefreshUpdates: getPendingUpdatesByKind("refresh"),
    pendingDiagnosticsUpdates: getPendingUpdatesByKind("diagnostics"),
    inFlightClusters: inFlight.size,
    maxConcurrentUpdates: getMaxConcurrentGlobalHealthUpdates(),
    maxConcurrentRefreshUpdates: getMaxConcurrentGlobalHealthUpdates("refresh"),
    maxConcurrentDiagnosticsUpdates: getMaxConcurrentGlobalHealthUpdates("diagnostics"),
  };
}

export function listGlobalWatcherRuntimeRows(): GlobalWatcherRuntimeRow[] {
  const clusterIds = new Set<string>([
    ...watchers.keys(),
    ...watcherIntervals.keys(),
    ...watcherLastDurationMs.keys(),
    ...watcherLastStartedAt.keys(),
    ...watcherLastSettledAt.keys(),
    ...pendingClusters.values(),
    ...inFlight.values(),
  ]);

  const states = get(clusterStates);
  return [...clusterIds]
    .map((clusterId) => ({
      clusterId,
      loading: states[clusterId]?.loading || inFlight.has(clusterId),
      pending: pendingClusters.has(clusterId),
      pendingKind: pendingClusterKinds.get(clusterId) ?? null,
      activeKind: inFlightKinds.get(clusterId) ?? null,
      intervalMs: watcherIntervals.get(clusterId) ?? null,
      lastDurationMs: watcherLastDurationMs.get(clusterId) ?? null,
      lastStartedAt: watcherLastStartedAt.get(clusterId) ?? null,
      lastSettledAt: watcherLastSettledAt.get(clusterId) ?? null,
    }))
    .sort((left, right) => {
      const rightDuration = right.lastDurationMs ?? -1;
      const leftDuration = left.lastDurationMs ?? -1;
      if (rightDuration !== leftDuration) return rightDuration - leftDuration;
      return left.clusterId.localeCompare(right.clusterId);
    });
}

export function restartWatcherForCluster(clusterId: string) {
  const streak = watcherErrorStreaks.get(clusterId) ?? 0;
  if (streak === 0) return;
  if (!watchers.has(clusterId)) return;
  watcherErrorStreaks.set(clusterId, 0);
  watcherLastSettledAt.delete(clusterId);
  clusterStates.update((states) => ({
    ...states,
    [clusterId]: { loading: false, error: null },
  }));
  // Run immediately then resume normal schedule (don't wait base interval)
  void updateClusterHealthChecks(clusterId).finally(() => {
    scheduleNextWatcher(clusterId);
  });
  void writeRuntimeDebugLog("watchers", "restart_recovered_cluster", { clusterId });
}

export function restartFailedWatchers() {
  let restarted = 0;
  for (const clusterId of watchers.keys()) {
    const streak = watcherErrorStreaks.get(clusterId) ?? 0;
    if (streak === 0) continue;
    watcherErrorStreaks.set(clusterId, 0);
    watcherLastSettledAt.delete(clusterId);
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
    scheduleNextWatcher(clusterId);
    restarted++;
  }
  if (restarted > 0) {
    void writeRuntimeDebugLog("watchers", "restart_failed", { restarted });
  }
}

clusterRuntimeContext.subscribe(() => {
  for (const clusterId of watchers.keys()) {
    if (shouldRunWatcher(clusterId)) {
      continue;
    }
    stopGlobalWatcher(clusterId);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const clusterId of watchers.keys()) {
    if (shouldRunWatcher(clusterId)) {
      continue;
    }
    stopGlobalWatcher(clusterId);
  }
});
