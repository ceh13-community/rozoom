import { derived, writable, type Readable } from "svelte/store";

export type ReplicaSetsSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

const DEFAULT_STATUS: ReplicaSetsSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,
};

const statuses = writable<Record<string, ReplicaSetsSyncStatus>>({});

function upsertStatus(
  clusterId: string,
  updater: (prev: ReplicaSetsSyncStatus) => ReplicaSetsSyncStatus,
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

export function selectClusterReplicaSetsSyncStatus(
  clusterId: string,
): Readable<ReplicaSetsSyncStatus> {
  return derived(statuses, ($statuses) => $statuses[clusterId] ?? DEFAULT_STATUS);
}

export function setReplicaSetsSyncEnabled(clusterId: string, enabled: boolean) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    enabled,
    isLoading: enabled ? prev.isLoading : false,
    error: enabled ? prev.error : null,
  }));
}

export function markReplicaSetsSyncLoading(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: true,
    error: null,
  }));
}

export function markReplicaSetsSyncSuccess(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: null,
    lastUpdatedAt: Date.now(),
  }));
}

export function markReplicaSetsSyncError(clusterId: string, error: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: error || "ReplicaSets watcher sync failed.",
  }));
}

export function resetReplicaSetsSyncStatus(clusterId: string) {
  if (!clusterId) return;
  statuses.update((current) => {
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== clusterId));
  });
}
