import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  markReplicaSetsSyncError,
  markReplicaSetsSyncLoading,
  markReplicaSetsSyncSuccess,
  resetReplicaSetsSyncStatus,
  selectClusterReplicaSetsSyncStatus,
  setReplicaSetsSyncEnabled,
} from "./replicasets-sync-status-store";

const clusterId = "cluster-a";

describe("replicasets-sync-status-store", () => {
  beforeEach(() => {
    resetReplicaSetsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterReplicaSetsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setReplicaSetsSyncEnabled(clusterId, true);
    markReplicaSetsSyncLoading(clusterId);

    let status = get(selectClusterReplicaSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markReplicaSetsSyncSuccess(clusterId);
    status = get(selectClusterReplicaSetsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setReplicaSetsSyncEnabled(clusterId, true);
    markReplicaSetsSyncError(clusterId, "failed");

    let status = get(selectClusterReplicaSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setReplicaSetsSyncEnabled(clusterId, false);
    status = get(selectClusterReplicaSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
