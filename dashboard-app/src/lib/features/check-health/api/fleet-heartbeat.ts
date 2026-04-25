import { get } from "svelte/store";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { clusterStates, restartWatcherForCluster } from "$features/check-health/model/watchers";
import { getFeatureCapability } from "$features/check-health/model/feature-capability-cache";
import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
import { isAuthError } from "$widgets/datalists/ui/model/overview-diagnostics";

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_RECOVERY_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT = "5s";

let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let activeClusterIds: string[] = [];

function isPageVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

function shouldSkipCluster(clusterId: string): boolean {
  const cached = getFeatureCapability(clusterId, "heartbeat");
  if (!cached) return false;
  return cached.status === "unsupported" || cached.status === "forbidden";
}

type ProbeResult = { ok: true } | { ok: false; errorMessage: string };

async function probeCluster(clusterId: string): Promise<ProbeResult> {
  try {
    const result = await kubectlRawFront(
      `get --raw=/healthz --request-timeout=${HEARTBEAT_TIMEOUT}`,
      { clusterId },
    );
    if (result.code === 0 && result.output.trim().toLowerCase().startsWith("ok")) {
      return { ok: true };
    }
    const rawError = `${result.errors} ${result.output}`.trim();
    return {
      ok: false,
      errorMessage: rawError || `healthz probe exited with code ${result.code}`,
    };
  } catch (err) {
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : "Unable to connect to the server",
    };
  }
}

async function runHeartbeatCycle() {
  if (!isPageVisible()) return;

  for (const clusterId of activeClusterIds) {
    if (!isPageVisible()) break;
    if (shouldSkipCluster(clusterId)) continue;

    const probe = await probeCluster(clusterId);
    const states = get(clusterStates);
    const current = states[clusterId] as { loading: boolean; error: string | null } | undefined;
    const wasInError = Boolean(current?.error);

    clusterStates.update((s) => {
      const cur = s[clusterId] as { loading: boolean; error: string | null } | undefined;
      // Clear only network-level errors on /healthz success. Auth failures
      // from workload watchers must persist even when /healthz is open,
      // because /healthz typically bypasses RBAC and its success does not
      // prove that tokens are still valid.
      if (probe.ok && cur?.error && !isAuthError(cur.error)) {
        return { ...s, [clusterId]: { ...cur, error: null } };
      }
      if (!probe.ok && cur && cur.error !== probe.errorMessage) {
        return { ...s, [clusterId]: { ...cur, error: probe.errorMessage } };
      }
      return s;
    });

    // Only restart watcher when cluster actually recovered from error state
    // (but not from an auth error - /healthz success does not indicate auth
    // is healthy). Avoids resetting streaks for clusters failing due to
    // RBAC/data errors while /healthz still passes.
    if (probe.ok && wasInError && !isAuthError(current?.error ?? "")) {
      restartWatcherForCluster(clusterId);
    }
  }
}

function hasErrorClusters(): boolean {
  const states = get(clusterStates);
  return activeClusterIds.some((id) => {
    const state = states[id] as { error: string | null } | undefined;
    return Boolean(state?.error);
  });
}

function scheduleHeartbeat() {
  const intervalMs = hasErrorClusters() ? HEARTBEAT_RECOVERY_INTERVAL_MS : HEARTBEAT_INTERVAL_MS;
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    void runHeartbeatCycle().then(() => {
      if (activeClusterIds.length > 0) {
        scheduleHeartbeat();
      }
    });
  }, intervalMs);
}

export function startFleetHeartbeat(clusterIds: string[]) {
  stopFleetHeartbeat();
  if (clusterIds.length === 0) return;
  activeClusterIds = [...clusterIds];
  void writeRuntimeDebugLog("fleet-heartbeat", "start", { count: clusterIds.length });
  scheduleHeartbeat();
}

export function stopFleetHeartbeat() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  activeClusterIds = [];
}
