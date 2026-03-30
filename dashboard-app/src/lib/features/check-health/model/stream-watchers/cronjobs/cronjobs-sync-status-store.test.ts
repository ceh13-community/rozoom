import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  markCronJobsSyncError,
  markCronJobsSyncLoading,
  markCronJobsSyncSuccess,
  resetCronJobsSyncStatus,
  selectClusterCronJobsSyncStatus,
  setCronJobsSyncEnabled,
} from "./cronjobs-sync-status-store";

const clusterId = "cluster-a";

describe("cronjobs-sync-status-store", () => {
  beforeEach(() => {
    resetCronJobsSyncStatus(clusterId);
  });

  it("returns default state for unknown cluster", () => {
    const status = get(selectClusterCronJobsSyncStatus(clusterId));
    expect(status).toEqual({
      enabled: false,
      isLoading: false,
      error: null,
      lastUpdatedAt: null,
    });
  });

  it("tracks loading and success", () => {
    setCronJobsSyncEnabled(clusterId, true);
    markCronJobsSyncLoading(clusterId);

    let status = get(selectClusterCronJobsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.isLoading).toBe(true);
    expect(status.error).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T10:00:00Z"));
    markCronJobsSyncSuccess(clusterId);
    status = get(selectClusterCronJobsSyncStatus(clusterId));
    expect(status.isLoading).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastUpdatedAt).toBe(new Date("2026-02-13T10:00:00Z").getTime());
    vi.useRealTimers();
  });

  it("tracks error and clears transient fields when disabled", () => {
    setCronJobsSyncEnabled(clusterId, true);
    markCronJobsSyncError(clusterId, "failed");

    let status = get(selectClusterCronJobsSyncStatus(clusterId));
    expect(status.enabled).toBe(true);
    expect(status.error).toBe("failed");
    expect(status.isLoading).toBe(false);

    setCronJobsSyncEnabled(clusterId, false);
    status = get(selectClusterCronJobsSyncStatus(clusterId));
    expect(status.enabled).toBe(false);
    expect(status.error).toBeNull();
    expect(status.isLoading).toBe(false);
  });
});
