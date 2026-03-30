import { derived, writable, type Readable } from "svelte/store";

export type StatefulSetsSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

const DEFAULT_STATUS: StatefulSetsSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,
};

const statuses = writable<Record<string, StatefulSetsSyncStatus>>({});

function upsertStatus(
  clusterId: string,
  updater: (prev: StatefulSetsSyncStatus) => StatefulSetsSyncStatus,
) {
  if (!clusterId) return;
  statuses.update((current) => {
    const prev = current[clusterId] ?? DEFAULT_STATUS;
    return {
      ...current,
      [clusterId]: updater(prev),
    };
  });
}

export function selectClusterStatefulSetsSyncStatus(
  clusterId: string,
): Readable<StatefulSetsSyncStatus> {
  return derived(statuses, ($statuses) => $statuses[clusterId] ?? DEFAULT_STATUS);
}

export function setStatefulSetsSyncEnabled(clusterId: string, enabled: boolean) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    enabled,
    isLoading: enabled ? prev.isLoading : false,
    error: enabled ? prev.error : null,
  }));
}

export function markStatefulSetsSyncLoading(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: true,
    error: null,
  }));
}

export function markStatefulSetsSyncSuccess(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: null,
    lastUpdatedAt: Date.now(),
  }));
}

export function markStatefulSetsSyncError(clusterId: string, error: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: error || "StatefulSets watcher sync failed.",
  }));
}

export function resetStatefulSetsSyncStatus(clusterId: string) {
  if (!clusterId) return;
  statuses.update((current) => {
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== clusterId));
  });
}
