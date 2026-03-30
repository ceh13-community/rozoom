import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";
import {
  markPodsSyncError,
  markPodsSyncLoading,
  markPodsSyncSuccess,
  resetPodsSyncStatus,
  selectClusterPodsSyncStatus,
  setPodsSyncEnabled,
} from "./pods-sync-status-store";

const clusterId = "cluster-a";

describe("pods-sync-status-store", () => {
  beforeEach(() => {
    resetPodsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterPodsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setPodsSyncEnabled(clusterId, true);
    markPodsSyncLoading(clusterId);

    let status = get(selectClusterPodsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markPodsSyncSuccess(clusterId);
    status = get(selectClusterPodsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setPodsSyncEnabled(clusterId, true);
    markPodsSyncError(clusterId, "failed");

    let status = get(selectClusterPodsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setPodsSyncEnabled(clusterId, false);
    status = get(selectClusterPodsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
