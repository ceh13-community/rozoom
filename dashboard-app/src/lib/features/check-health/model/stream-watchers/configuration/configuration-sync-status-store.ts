import { derived, writable, type Readable } from "svelte/store";

export type ConfigurationSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

const DEFAULT_STATUS: ConfigurationSyncStatus = {
  enabled: false,
  isLoading: false,
  error: null,
  lastUpdatedAt: null,
};

const statuses = writable<Record<string, ConfigurationSyncStatus>>({});

function makeStatusKey(clusterId: string, workloadType: string) {
  return `${clusterId}:${workloadType}`;
}

function upsertStatus(
  clusterId: string,
  workloadType: string,
  updater: (prev: ConfigurationSyncStatus) => ConfigurationSyncStatus,
) {
  if (!clusterId || !workloadType) return;
  const key = makeStatusKey(clusterId, workloadType);
  statuses.update((current) => {
    const prev = current[key] ?? DEFAULT_STATUS;
    return {
      ...current,
      [key]: updater(prev),
    };
  });
}

export function selectClusterConfigurationSyncStatus(
  clusterId: string,
  workloadType: string,
): Readable<ConfigurationSyncStatus> {
  const key = makeStatusKey(clusterId, workloadType);
  return derived(statuses, ($statuses) => $statuses[key] ?? DEFAULT_STATUS);
}

export function setConfigurationSyncEnabled(
  clusterId: string,
  workloadType: string,
  enabled: boolean,
) {
  upsertStatus(clusterId, workloadType, (prev) => ({
    ...prev,
    enabled,
    isLoading: enabled ? prev.isLoading : false,
    error: enabled ? prev.error : null,
  }));
}

export function markConfigurationSyncLoading(clusterId: string, workloadType: string) {
  upsertStatus(clusterId, workloadType, (prev) => ({
    ...prev,
    isLoading: true,
    error: null,
  }));
}

export function markConfigurationSyncSuccess(clusterId: string, workloadType: string) {
  upsertStatus(clusterId, workloadType, (prev) => ({
    ...prev,
    isLoading: false,
    error: null,
    lastUpdatedAt: Date.now(),
  }));
}

export function markConfigurationSyncError(clusterId: string, workloadType: string, error: string) {
  upsertStatus(clusterId, workloadType, (prev) => ({
    ...prev,
    isLoading: false,
    error: error || "Configuration watcher sync failed.",
  }));
}

export function resetConfigurationSyncStatus(clusterId: string, workloadType: string) {
  if (!clusterId || !workloadType) return;
  const key = makeStatusKey(clusterId, workloadType);
  statuses.update((current) => {
    return Object.fromEntries(Object.entries(current).filter(([currentKey]) => currentKey !== key));
  });
}
