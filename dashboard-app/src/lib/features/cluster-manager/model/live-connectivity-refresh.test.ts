import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClusterConnectivity } from "$shared/model/cluster-connectivity";
import {
  MANAGER_CONNECTIVITY_REFRESH_MS,
  clustersToRecheck,
  startConnectivityRefresh,
} from "./live-connectivity-refresh";

function entry(state: ClusterConnectivity["state"]): ClusterConnectivity {
  return {
    state,
    reason: null,
    detail: null,
    checking: false,
    lastContactAt: null,
    lastKnownVersion: null,
    checkedAt: null,
  };
}

describe("clustersToRecheck", () => {
  it("re-checks only clusters that answered or stopped answering this session", () => {
    const clusters = [
      { uuid: "answered" },
      { uuid: "stopped" },
      { uuid: "never-contacted" },
      { uuid: "auth-expired" },
      { uuid: "switched-off", offline: true },
    ];
    const connectivity = {
      answered: entry("online"),
      stopped: entry("unreachable"),
      "never-contacted": entry("unknown"),
      "auth-expired": entry("auth-expired"),
      "switched-off": entry("online"),
    };
    expect(clustersToRecheck(clusters, connectivity)).toEqual(["answered", "stopped"]);
  });
});

describe("startConnectivityRefresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks at once, then every 30 seconds, and stops when asked", async () => {
    const check = vi.fn<(clusterId: string) => Promise<unknown>>(async () => undefined);
    const stop = startConnectivityRefresh({ pickClusterIds: () => ["a", "b"], check });
    await vi.advanceTimersByTimeAsync(0);
    expect(check.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);

    await vi.advanceTimersByTimeAsync(MANAGER_CONNECTIVITY_REFRESH_MS);
    expect(check).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(MANAGER_CONNECTIVITY_REFRESH_MS * 3);
    expect(check).toHaveBeenCalledTimes(4);
    expect(MANAGER_CONNECTIVITY_REFRESH_MS).toBe(30_000);
  });

  it("skips rounds while the window is hidden", async () => {
    let visible = false;
    const check = vi.fn(async () => undefined);
    const stop = startConnectivityRefresh({
      pickClusterIds: () => ["a"],
      check,
      isPageVisible: () => visible,
    });
    await vi.advanceTimersByTimeAsync(MANAGER_CONNECTIVITY_REFRESH_MS);
    expect(check).not.toHaveBeenCalled();

    visible = true;
    await vi.advanceTimersByTimeAsync(MANAGER_CONNECTIVITY_REFRESH_MS);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not start a new round while the last one still runs", async () => {
    let release: () => void = () => undefined;
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const stop = startConnectivityRefresh({ pickClusterIds: () => ["slow"], check });
    await vi.advanceTimersByTimeAsync(MANAGER_CONNECTIVITY_REFRESH_MS * 2);
    expect(check).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(MANAGER_CONNECTIVITY_REFRESH_MS);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps going after a failed check", async () => {
    const check = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const stop = startConnectivityRefresh({ pickClusterIds: () => ["a", "b"], check });
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });
});
