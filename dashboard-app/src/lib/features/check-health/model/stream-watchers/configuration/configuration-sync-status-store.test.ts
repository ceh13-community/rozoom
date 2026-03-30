import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  markConfigurationSyncError,
  markConfigurationSyncLoading,
  markConfigurationSyncSuccess,
  resetConfigurationSyncStatus,
  selectClusterConfigurationSyncStatus,
  setConfigurationSyncEnabled,
} from "./configuration-sync-status-store";

describe("configuration-sync-status-store", () => {
  const clusterId = "cluster-a";
  const workloadType = "configmaps";

  beforeEach(() => {
    resetConfigurationSyncStatus(clusterId, workloadType);
  });

  it("tracks loading and success states", () => {
    setConfigurationSyncEnabled(clusterId, workloadType, true);
    markConfigurationSyncLoading(clusterId, workloadType);

    const loading = get(selectClusterConfigurationSyncStatus(clusterId, workloadType));
    expect(loading.enabled).toBe(true);
    expect(loading.isLoading).toBe(true);
    expect(loading.error).toBeNull();

    markConfigurationSyncSuccess(clusterId, workloadType);
    const success = get(selectClusterConfigurationSyncStatus(clusterId, workloadType));
    expect(success.isLoading).toBe(false);
    expect(success.error).toBeNull();
    expect(success.lastUpdatedAt).not.toBeNull();
  });

  it("tracks error state and reset", () => {
    setConfigurationSyncEnabled(clusterId, workloadType, true);
    markConfigurationSyncError(clusterId, workloadType, "sync failed");
    const errored = get(selectClusterConfigurationSyncStatus(clusterId, workloadType));
    expect(errored.error).toBe("sync failed");
    expect(errored.isLoading).toBe(false);

    resetConfigurationSyncStatus(clusterId, workloadType);
    const reset = get(selectClusterConfigurationSyncStatus(clusterId, workloadType));
    expect(reset.enabled).toBe(false);
    expect(reset.lastUpdatedAt).toBeNull();
    expect(reset.error).toBeNull();
  });
});
