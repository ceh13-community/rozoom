import { derived, writable, type Readable } from "svelte/store";
import { checkNodesHealth, type NodeHealth } from "../api/check-node-health";
import {
  clusterRuntimeContext,
  isClusterRuntimePlaneActive,
} from "$shared/lib/cluster-runtime-manager";
import {
  activeDashboardRoute,
  isClusterWorkloadRouteActive,
} from "$shared/lib/dashboard-route-activity";

type HealthState = {
  enabled: boolean;
  data: NodeHealth[];
  lastUpdatedAt: number | null;
  isLoading: boolean;
  error: string | null;
};

const DEFAULT_POLL_MS = 20_000;
const JITTER_MS = 1_500;

const healthStore = writable<Record<string, HealthState>>({});

type Controller = {
  refCount: number;
  pollMs: number;
  paused: boolean;
  runtimePaused: boolean;
  inFlight: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
};

const controllers = new Map<string, Controller>();

function ensureState(): HealthState {
  return {
    enabled: false,
    data: [],
    lastUpdatedAt: null,
    isLoading: false,
    error: null,
  };
}

function setState(clusterId: string, patch: Partial<HealthState>) {
  healthStore.update((s) => {
    const prev = s[clusterId] ?? ensureState();
    return { ...s, [clusterId]: { ...prev, ...patch } };
  });
}

function jitter() {
  return Math.floor(Math.random() * JITTER_MS);
}

function schedule(clusterId: string, delayMs: number) {
  const ctl = controllers.get(clusterId);
  if (!ctl) return;
  if (ctl.paused || ctl.runtimePaused) return;

  if (ctl.timeoutId) clearTimeout(ctl.timeoutId);

  ctl.timeoutId = setTimeout(() => {
    void runOnce(clusterId);
  }, delayMs);
}

async function runOnce(clusterId: string) {
  const ctl = controllers.get(clusterId);
  if (!ctl || ctl.paused || ctl.runtimePaused || ctl.inFlight) {
    if (ctl && !ctl.paused && !ctl.runtimePaused) schedule(clusterId, ctl.pollMs + jitter());
    return;
  }

  ctl.inFlight = true;
  setState(clusterId, { isLoading: true, error: null });

  try {
    const res = await checkNodesHealth(clusterId);
    const data = Array.isArray(res) ? res : res ? [res] : [];

    setState(clusterId, {
      data,
      lastUpdatedAt: Date.now(),
      isLoading: false,
      error: null,
    });

    // Success -> reduce backoff
    ctl.backoffMs = 0;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";

    setState(clusterId, {
      isLoading: false,
      error: msg,
    });

    // Error -> exponential backoff capped
    ctl.backoffMs = ctl.backoffMs === 0 ? 5_000 : Math.min(60_000, ctl.backoffMs * 2);
  } finally {
    ctl.inFlight = false;
    schedule(clusterId, (ctl.backoffMs > 0 ? ctl.backoffMs : ctl.pollMs) + jitter());
  }
}

function onVisibilityChange() {
  const hidden = typeof document !== "undefined" ? document.hidden : false;

  for (const [, ctl] of controllers) {
    ctl.paused = hidden;
    // When going to hidden, stop polling
    if (hidden && ctl.timeoutId) {
      clearTimeout(ctl.timeoutId);
      ctl.timeoutId = null;
    }
  }

  // When returning to visible, kick all clusters once (staggered)
  if (!hidden) {
    let offset = 0;
    for (const clusterId of controllers.keys()) {
      const ctl = controllers.get(clusterId);
      if (!ctl || ctl.runtimePaused) continue;
      setTimeout(() => void runOnce(clusterId), offset + jitter());
      offset += 250;
    }
  }
}

function syncRuntimeState(clusterId: string, controller: Controller) {
  controller.runtimePaused =
    !isClusterRuntimePlaneActive(clusterId, "diagnostics") ||
    !isClusterWorkloadRouteActive(clusterId, "nodesstatus");

  if (controller.runtimePaused) {
    if (controller.timeoutId) {
      clearTimeout(controller.timeoutId);
      controller.timeoutId = null;
    }
    return;
  }

  if (
    controller.refCount > 0 &&
    !controller.paused &&
    !controller.inFlight &&
    !controller.timeoutId
  ) {
    schedule(clusterId, jitter());
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", onVisibilityChange);
}

clusterRuntimeContext.subscribe(() => {
  for (const [clusterId, controller] of controllers.entries()) {
    syncRuntimeState(clusterId, controller);
  }
});

activeDashboardRoute.subscribe(() => {
  for (const [clusterId, controller] of controllers.entries()) {
    syncRuntimeState(clusterId, controller);
  }
});

export function startNodesHealthPolling(clusterId: string, pollMs: number = DEFAULT_POLL_MS) {
  const existing = controllers.get(clusterId);
  if (existing) {
    existing.refCount += 1;
    existing.pollMs = pollMs;
    syncRuntimeState(clusterId, existing);
    setState(clusterId, { enabled: true });
    return;
  }

  const controller: Controller = {
    refCount: 1,
    pollMs,
    paused: typeof document !== "undefined" ? document.hidden : false,
    runtimePaused: !isClusterRuntimePlaneActive(clusterId, "diagnostics"),
    inFlight: false,
    timeoutId: null,
    backoffMs: 0,
  };
  controllers.set(clusterId, controller);

  // Preserve the latest known data when restarting polling to avoid UI flicker.
  setState(clusterId, { enabled: true, error: null });

  syncRuntimeState(clusterId, controller);
}

export async function refreshNodesHealthNow(clusterId: string) {
  const existing = controllers.get(clusterId);
  if (existing) {
    if (existing.timeoutId) {
      clearTimeout(existing.timeoutId);
      existing.timeoutId = null;
    }
    await runOnce(clusterId);
    return;
  }

  const controller: Controller = {
    refCount: 0,
    pollMs: DEFAULT_POLL_MS,
    paused: typeof document !== "undefined" ? document.hidden : false,
    runtimePaused: !isClusterRuntimePlaneActive(clusterId, "diagnostics"),
    inFlight: false,
    timeoutId: null,
    backoffMs: 0,
  };
  controllers.set(clusterId, controller);

  try {
    await runOnce(clusterId);
  } finally {
    const latest = controllers.get(clusterId);
    if (latest?.refCount === 0) {
      if (latest.timeoutId) {
        clearTimeout(latest.timeoutId);
        latest.timeoutId = null;
      }
      controllers.delete(clusterId);
      setState(clusterId, { enabled: false });
    }
  }
}

export function stopNodesHealthPolling(clusterId: string) {
  const ctl = controllers.get(clusterId);
  if (!ctl) return;

  ctl.refCount -= 1;
  if (ctl.refCount > 0) return;

  if (ctl.timeoutId) clearTimeout(ctl.timeoutId);
  controllers.delete(clusterId);
  setState(clusterId, { enabled: false });
}

export function stopAllNodesHealthPolling() {
  for (const clusterId of [...controllers.keys()]) {
    const ctl = controllers.get(clusterId);
    if (!ctl) continue;
    ctl.refCount = 1;
    stopNodesHealthPolling(clusterId);
  }
}

export function selectClusterNodesHealth(clusterId: string): Readable<HealthState> {
  return derived(healthStore, ($store) => $store[clusterId] ?? ensureState());
}
