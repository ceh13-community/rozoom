import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  markStatefulSetsSyncError,
  markStatefulSetsSyncLoading,
  markStatefulSetsSyncSuccess,
  resetStatefulSetsSyncStatus,
  selectClusterStatefulSetsSyncStatus,
  setStatefulSetsSyncEnabled,
} from "./statefulsets-sync-status-store";

const clusterId = "cluster-a";

describe("statefulsets-sync-status-store", () => {
  beforeEach(() => {
    resetStatefulSetsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterStatefulSetsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setStatefulSetsSyncEnabled(clusterId, true);
    markStatefulSetsSyncLoading(clusterId);

    let status = get(selectClusterStatefulSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markStatefulSetsSyncSuccess(clusterId);
    status = get(selectClusterStatefulSetsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setStatefulSetsSyncEnabled(clusterId, true);
    markStatefulSetsSyncError(clusterId, "failed");

    let status = get(selectClusterStatefulSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setStatefulSetsSyncEnabled(clusterId, false);
    status = get(selectClusterStatefulSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
