import { derived, writable, type Readable } from "svelte/store";

export type PodsSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

const DEFAULT_STATUS: PodsSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,
};

const statuses = writable<Record<string, PodsSyncStatus>>({});

function upsertStatus(clusterId: string, updater: (prev: PodsSyncStatus) => PodsSyncStatus) {
  if (!clusterId) return;
  statuses.update((current) => {
    const prev = current[clusterId] ?? DEFAULT_STATUS;
    return {
      ...current,
      [clusterId]: updater(prev),
    };
  });
}

export function selectClusterPodsSyncStatus(clusterId: string): Readable<PodsSyncStatus> {
  return derived(statuses, ($statuses) => $statuses[clusterId] ?? DEFAULT_STATUS);
}

export function setPodsSyncEnabled(clusterId: string, enabled: boolean) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    enabled,
    isLoading: enabled ? prev.isLoading : false,
    error: enabled ? prev.error : null,
  }));
}

export function markPodsSyncLoading(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: true,
    error: null,
  }));
}

export function markPodsSyncSuccess(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: null,
    lastUpdatedAt: Date.now(),
  }));
}

export function markPodsSyncError(clusterId: string, error: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: error || "Pod watcher sync failed.",
  }));
}

export function resetPodsSyncStatus(clusterId: string) {
  if (!clusterId) return;
  statuses.update((current) => {
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== clusterId));
  });
}
