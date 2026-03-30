import { derived, writable, type Readable } from "svelte/store";

export type JobsSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

const DEFAULT_STATUS: JobsSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,
};

const statuses = writable<Record<string, JobsSyncStatus>>({});

function upsertStatus(clusterId: string, updater: (prev: JobsSyncStatus) => JobsSyncStatus) {
  if (!clusterId) return;
  statuses.update((current) => {
    const prev = current[clusterId] ?? DEFAULT_STATUS;
    return {
      ...current,
      [clusterId]: updater(prev),
    };
  });
}

export function selectClusterJobsSyncStatus(clusterId: string): Readable<JobsSyncStatus> {
  return derived(statuses, ($statuses) => $statuses[clusterId] ?? DEFAULT_STATUS);
}

export function setJobsSyncEnabled(clusterId: string, enabled: boolean) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    enabled,
    isLoading: enabled ? prev.isLoading : false,
    error: enabled ? prev.error : null,
  }));
}

export function markJobsSyncLoading(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: true,
    error: null,
  }));
}

export function markJobsSyncSuccess(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: null,
    lastUpdatedAt: Date.now(),
  }));
}

export function markJobsSyncError(clusterId: string, error: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: error || "Jobs watcher sync failed.",
  }));
}

export function resetJobsSyncStatus(clusterId: string) {
  if (!clusterId) return;
  statuses.update((current) => {
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== clusterId));
  });
}
