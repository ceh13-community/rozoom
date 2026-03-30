import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { clusterStates } from "$features/check-health/model/watchers";
import { getFeatureCapability } from "$features/check-health/model/feature-capability-cache";
import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";

const HEARTBEAT_INTERVAL_MS = 60_000;
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

async function probeCluster(clusterId: string): Promise<boolean> {
  try {
    const result = await kubectlRawFront(
      `get --raw=/healthz --request-timeout=${HEARTBEAT_TIMEOUT}`,
      { clusterId },
    );
    return result.code === 0 && result.output.trim().toLowerCase().startsWith("ok");
  } catch {
    return false;
  }
}

async function runHeartbeatCycle() {
  if (!isPageVisible()) return;

  for (const clusterId of activeClusterIds) {
    if (!isPageVisible()) break;
    if (shouldSkipCluster(clusterId)) continue;

    const ok = await probeCluster(clusterId);
    clusterStates.update((states) => {
      const current = states[clusterId] as { loading: boolean; error: string | null } | undefined;
      if (ok && current?.error) {
        return { ...states, [clusterId]: { ...current, error: null } };
      }
      if (!ok && current && !current.error) {
        return { ...states, [clusterId]: { ...current, error: "Unable to connect to the server" } };
      }
      return states;
    });
  }
}

function scheduleHeartbeat() {
  heartbeatTimer = setTimeout(() => {
    heartbeatTimer = null;
    void runHeartbeatCycle().then(() => {
      if (activeClusterIds.length > 0) {
        scheduleHeartbeat();
      }
    });
  }, HEARTBEAT_INTERVAL_MS);
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
