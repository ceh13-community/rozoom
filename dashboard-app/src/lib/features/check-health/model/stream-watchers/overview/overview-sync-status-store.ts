import { derived, writable, type Readable } from "svelte/store";

type OverviewSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  partialMessage: string | null;
  lastUpdatedAt: number | null;
};

const statuses = writable<Record<string, OverviewSyncStatus>>({});

const DEFAULT_STATUS: OverviewSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  partialMessage: null,
  lastUpdatedAt: null,
};

function updateStatus(clusterId: string, patch: Partial<OverviewSyncStatus>) {
  if (!clusterId) return;
  statuses.update((state) => {
    const prev = state[clusterId] ?? DEFAULT_STATUS;
    return {
      ...state,
      [clusterId]: {
        ...prev,
        ...patch,
      },
    };
  });
}

export function selectClusterOverviewSyncStatus(clusterId: string): Readable<OverviewSyncStatus> {
  return derived(statuses, ($statuses) => $statuses[clusterId] ?? DEFAULT_STATUS);
}

export function setOverviewSyncEnabled(clusterId: string, enabled: boolean) {
  updateStatus(clusterId, { enabled });
}

export function markOverviewSyncLoading(clusterId: string) {
  updateStatus(clusterId, { isLoading: true, error: null, partialMessage: null });
}

export function markOverviewSyncSuccess(clusterId: string, at: number = Date.now()) {
  updateStatus(clusterId, {
    isLoading: false,
    error: null,
    partialMessage: null,
    lastUpdatedAt: at,
  });
}

export function seedOverviewSyncLastUpdated(clusterId: string, at: number) {
  if (!Number.isFinite(at) || at <= 0) return;
  updateStatus(clusterId, {
    isLoading: false,
    error: null,
    partialMessage: null,
    lastUpdatedAt: at,
  });
}

export function markOverviewSyncPartial(
  clusterId: string,
  message: string,
  at: number = Date.now(),
) {
  updateStatus(clusterId, {
    isLoading: false,
    error: null,
    partialMessage: message,
    lastUpdatedAt: at,
  });
}

export function markOverviewSyncError(clusterId: string, message: string) {
  updateStatus(clusterId, {
    isLoading: false,
    error: message,
    partialMessage: null,
  });
}

export function resetOverviewSyncStatus(clusterId: string) {
  if (!clusterId) return;
  statuses.update((state) => ({
    ...state,
    [clusterId]: DEFAULT_STATUS,
  }));
}
