import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  markDeploymentsSyncError,
  markDeploymentsSyncLoading,
  markDeploymentsSyncSuccess,
  resetDeploymentsSyncStatus,
  selectClusterDeploymentsSyncStatus,
  setDeploymentsSyncEnabled,
} from "./deployments-sync-status-store";

const clusterId = "cluster-a";

describe("deployments-sync-status-store", () => {
  beforeEach(() => {
    resetDeploymentsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterDeploymentsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setDeploymentsSyncEnabled(clusterId, true);
    markDeploymentsSyncLoading(clusterId);

    let status = get(selectClusterDeploymentsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markDeploymentsSyncSuccess(clusterId);
    status = get(selectClusterDeploymentsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setDeploymentsSyncEnabled(clusterId, true);
    markDeploymentsSyncError(clusterId, "failed");

    let status = get(selectClusterDeploymentsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setDeploymentsSyncEnabled(clusterId, false);
    status = get(selectClusterDeploymentsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
