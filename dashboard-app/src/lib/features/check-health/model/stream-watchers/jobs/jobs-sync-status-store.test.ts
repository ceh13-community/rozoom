import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  markJobsSyncError,
  markJobsSyncLoading,
  markJobsSyncSuccess,
  resetJobsSyncStatus,
  selectClusterJobsSyncStatus,
  setJobsSyncEnabled,
} from "./jobs-sync-status-store";

const clusterId = "cluster-a";

describe("jobs-sync-status-store", () => {
  beforeEach(() => {
    resetJobsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterJobsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setJobsSyncEnabled(clusterId, true);
    markJobsSyncLoading(clusterId);

    let status = get(selectClusterJobsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markJobsSyncSuccess(clusterId);
    status = get(selectClusterJobsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setJobsSyncEnabled(clusterId, true);
    markJobsSyncError(clusterId, "failed");

    let status = get(selectClusterJobsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setJobsSyncEnabled(clusterId, false);
    status = get(selectClusterJobsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
