import { derived, writable, type Readable } from "svelte/store";

export type DeploymentsSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

const DEFAULT_STATUS: DeploymentsSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,
};

const statuses = writable<Record<string, DeploymentsSyncStatus>>({});

function upsertStatus(
  clusterId: string,
  updater: (prev: DeploymentsSyncStatus) => DeploymentsSyncStatus,
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

export function selectClusterDeploymentsSyncStatus(
  clusterId: string,
): Readable<DeploymentsSyncStatus> {
  return derived(statuses, ($statuses) => $statuses[clusterId] ?? DEFAULT_STATUS);
}

export function setDeploymentsSyncEnabled(clusterId: string, enabled: boolean) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    enabled,
    isLoading: enabled ? prev.isLoading : false,
    error: enabled ? prev.error : null,
  }));
}

export function markDeploymentsSyncLoading(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: true,
    error: null,
  }));
}

export function markDeploymentsSyncSuccess(clusterId: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: null,
    lastUpdatedAt: Date.now(),
  }));
}

export function markDeploymentsSyncError(clusterId: string, error: string) {
  upsertStatus(clusterId, (prev) => ({
    ...prev,
    isLoading: false,
    error: error || "Deployment watcher sync failed.",
  }));
}

export function resetDeploymentsSyncStatus(clusterId: string) {
  if (!clusterId) return;
  statuses.update((current) => {
    return Object.fromEntries(Object.entries(current).filter(([key]) => key !== clusterId));
  });
}
