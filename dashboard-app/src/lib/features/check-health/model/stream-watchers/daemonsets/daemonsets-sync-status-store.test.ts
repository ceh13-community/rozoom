import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  markDaemonSetsSyncError,
  markDaemonSetsSyncLoading,
  markDaemonSetsSyncSuccess,
  resetDaemonSetsSyncStatus,
  selectClusterDaemonSetsSyncStatus,
  setDaemonSetsSyncEnabled,
} from "./daemonsets-sync-status-store";

const clusterId = "cluster-a";

describe("daemonsets-sync-status-store", () => {
  beforeEach(() => {
    resetDaemonSetsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterDaemonSetsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setDaemonSetsSyncEnabled(clusterId, true);
    markDaemonSetsSyncLoading(clusterId);

    let status = get(selectClusterDaemonSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markDaemonSetsSyncSuccess(clusterId);
    status = get(selectClusterDaemonSetsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setDaemonSetsSyncEnabled(clusterId, true);
    markDaemonSetsSyncError(clusterId, "failed");

    let status = get(selectClusterDaemonSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setDaemonSetsSyncEnabled(clusterId, false);
    status = get(selectClusterDaemonSetsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
