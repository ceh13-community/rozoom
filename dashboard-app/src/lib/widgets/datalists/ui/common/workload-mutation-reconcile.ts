import {
  beginMutationAck,
  cancelMutationAcksForScope,
} from "$features/check-health/model/stream-watchers/mutation-orchestrator";

type SyncMode = "manual" | "stream" | "poll";
type MutationEventType = "ADDED" | "MODIFIED" | "DELETED";

type MutationReconcileOptions = {
  isSyncEnabled: () => boolean;
  getSyncMode: () => SyncMode;
  getClusterId?: () => string | null;
  getScopeKey?: () => string | null;
  refresh: () => void | Promise<void>;
  fallbackDelayMs?: number;
};

type TrackMutationOptions = {
  ids: string[];
  expectedEventTypes: MutationEventType[];
};

export function createMutationReconcile(options: MutationReconcileOptions) {
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const fallbackDelayMs = options.fallbackDelayMs ?? 4_000;

  function clear() {
    if (!fallbackTimer) return;
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function schedule() {
    clear();
    if (!options.isSyncEnabled() || options.getSyncMode() !== "stream") {
      void options.refresh();
      return;
    }
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      void options.refresh();
    }, fallbackDelayMs);
  }

  function track(mutation?: TrackMutationOptions) {
    clear();
    const clusterId = options.getClusterId?.() ?? null;
    const scopeKey = options.getScopeKey?.() ?? null;

    if (
      !mutation ||
      !options.isSyncEnabled() ||
      options.getSyncMode() !== "stream" ||
      !clusterId ||
      !scopeKey
    ) {
      schedule();
      return;
    }

    beginMutationAck({
      clusterId,
      scopeKey,
      ids: mutation.ids,
      expectedEventTypes: mutation.expectedEventTypes,
      timeoutMs: fallbackDelayMs,
      onTimeout: () => {
        void options.refresh();
      },
    });
  }

  return {
    schedule,
    track,
    clear,
    clearScope() {
      clear();
      const clusterId = options.getClusterId?.() ?? null;
      const scopeKey = options.getScopeKey?.() ?? null;
      if (clusterId && scopeKey) {
        cancelMutationAcksForScope(clusterId, scopeKey);
      }
    },
  };
}
