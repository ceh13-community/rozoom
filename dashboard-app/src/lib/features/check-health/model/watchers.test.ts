// watchers.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";
import {
  resetClusterRuntimeContext,
  setClusterRuntimeBudget,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";
import { setKubectlExecutionBudget, resetKubectlExecutionBudget } from "$shared/api/kubectl-proxy";
import {
  startGlobalWatcher,
  stopGlobalWatcher,
  stopAllWatchers,
  clusterStates,
  getGlobalWatcherRuntimeSummary,
  listGlobalWatcherRuntimeRows,
  updateClusterHealthChecks,
} from "./watchers";
import { collectClusterData } from "./collect-cluster-data";
import { error as logError } from "@tauri-apps/plugin-log";
import { WATCHERS_INTERVAL } from "$entities/cluster";
import { globalLinterEnabled } from "./linter-preferences";

vi.mock("./collect-cluster-data", () => ({
  collectClusterData: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

const clusterId1 = "cluster-abc";
const clusterId2 = "cluster-xyz";

describe("watchers.ts", () => {
  const originalVisibilityState =
    typeof document !== "undefined" ? document.visibilityState : "visible";

  const setVisibility = (value: DocumentVisibilityState) => {
    if (typeof document === "undefined") return;
    Object.defineProperty(document, "visibilityState", {
      value,
      configurable: true,
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.clearAllTimers();

    resetClusterRuntimeContext();
    resetKubectlExecutionBudget();
    clusterStates.set({});
    globalLinterEnabled.set(true);
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    stopAllWatchers();
    resetClusterRuntimeContext();
    resetKubectlExecutionBudget();
    setVisibility(originalVisibilityState as DocumentVisibilityState);
  });

  it("startGlobalWatcher should set interval and update on first tick", async () => {
    vi.mocked(collectClusterData).mockResolvedValue({} as any);
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });

    startGlobalWatcher(clusterId1);

    expect(get(clusterStates)).toEqual({
      [clusterId1]: { loading: false, error: null },
    });

    expect(collectClusterData).not.toHaveBeenCalled();

    vi.advanceTimersByTime(WATCHERS_INTERVAL);

    await Promise.resolve();
    expect(collectClusterData).toHaveBeenCalledTimes(1);
  });

  it("respects a per-card 60 second interval instead of forcing dashboard root to 5 minutes", async () => {
    vi.mocked(collectClusterData).mockResolvedValue({} as any);
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });

    // First: do a manual refresh to establish a success baseline
    // (without prior success, the watcher uses a fast 30s retry)
    await updateClusterHealthChecks(clusterId1, { force: true });
    expect(collectClusterData).toHaveBeenCalledTimes(1);
    vi.mocked(collectClusterData).mockClear();

    startGlobalWatcher(clusterId1, 60_000);

    vi.advanceTimersByTime(59_000);
    await Promise.resolve();
    expect(collectClusterData).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    await vi.waitFor(() => {
      expect(collectClusterData).toHaveBeenCalledTimes(1);
    });
  });

  it("startGlobalWatcher should not create new watcher", () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });
    startGlobalWatcher(clusterId1);

    const firstInterval = vi.getTimerCount();

    startGlobalWatcher(clusterId1);

    expect(vi.getTimerCount()).toBe(firstInterval);
    expect(collectClusterData).toHaveBeenCalledTimes(0);
  });

  it("update should process errors from collectClusterData", async () => {
    const mockError = new Error("Network timeout");
    vi.mocked(collectClusterData).mockRejectedValue(mockError);
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });

    await updateClusterHealthChecks(clusterId1);

    expect(get(clusterStates)[clusterId1]).toEqual({
      loading: false,
      error: "Network timeout",
    });

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("[watcher:global-health] cluster-abc: Error: Network timeout"),
    );
  });

  it("skips updates when document is hidden", () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });
    setVisibility("hidden");
    startGlobalWatcher(clusterId1);

    expect(collectClusterData).not.toHaveBeenCalled();
    expect(get(clusterStates)[clusterId1]).toEqual({ loading: false, error: null });

    vi.advanceTimersByTime(WATCHERS_INTERVAL);
    expect(collectClusterData).not.toHaveBeenCalled();
  });

  it("avoids duplicate calls while a request is in flight", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });
    let resolvePromise: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    vi.mocked(collectClusterData).mockReturnValue(pendingPromise as any);

    const firstCall = updateClusterHealthChecks(clusterId1);
    const secondCall = updateClusterHealthChecks(clusterId1);

    expect(collectClusterData).toHaveBeenCalledTimes(1);

    resolvePromise!();
    await Promise.all([firstCall, secondCall]);

    await updateClusterHealthChecks(clusterId1);
    expect(collectClusterData).toHaveBeenCalledTimes(2);
  });

  it("queues another cluster while a global health update is already running", async () => {
    setClusterRuntimeContext({ activeClusterId: clusterId1, diagnosticsEnabled: true });
    let resolveFirst: (() => void) | undefined;
    vi.mocked(collectClusterData).mockImplementation((clusterId) => {
      if (clusterId === clusterId1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({} as any);
        }) as any;
      }
      return Promise.resolve({} as any);
    });

    const firstRun = updateClusterHealthChecks(clusterId1);
    await Promise.resolve();
    setClusterRuntimeContext({ activeClusterId: clusterId2, diagnosticsEnabled: true });
    await updateClusterHealthChecks(clusterId2);

    expect(collectClusterData).toHaveBeenCalledTimes(1);
    expect(collectClusterData).toHaveBeenCalledWith(
      clusterId1,
      expect.objectContaining({ mode: "full", shouldStop: expect.any(Function) }),
    );

    resolveFirst?.();
    await firstRun;
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(2);
    expect(collectClusterData).toHaveBeenLastCalledWith(
      clusterId2,
      expect.objectContaining({ mode: "full", shouldStop: expect.any(Function) }),
    );
  });

  it("caps dashboard concurrency to the kubectl exec budget", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1, clusterId2, "cluster-3", "cluster-4"],
      diagnosticsEnabled: true,
    });
    setClusterRuntimeBudget({ maxConcurrentConnections: 12 });
    setKubectlExecutionBudget({ maxConcurrentExecs: 6 });

    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    let resolveThird: (() => void) | undefined;
    vi.mocked(collectClusterData).mockImplementation((clusterId) => {
      if (clusterId === clusterId1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({} as any);
        }) as any;
      }
      if (clusterId === clusterId2) {
        return new Promise((resolve) => {
          resolveSecond = () => resolve({} as any);
        }) as any;
      }
      if (clusterId === "cluster-3") {
        return new Promise((resolve) => {
          resolveThird = () => resolve({} as any);
        }) as any;
      }
      return Promise.resolve({} as any);
    });

    void updateClusterHealthChecks(clusterId1, { force: true });
    void updateClusterHealthChecks(clusterId2, { force: true });
    void updateClusterHealthChecks("cluster-3", { force: true });
    await updateClusterHealthChecks("cluster-4", { force: true });

    expect(collectClusterData).toHaveBeenCalledTimes(3);

    resolveFirst?.();
    resolveSecond?.();
    resolveThird?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(4);
    expect(collectClusterData).toHaveBeenLastCalledWith(
      "cluster-4",
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );
  });

  it("stopGlobalWatcher should stop interval and clear state", async () => {
    vi.mocked(collectClusterData).mockResolvedValue({} as any);
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });

    startGlobalWatcher(clusterId1);

    vi.advanceTimersByTime(WATCHERS_INTERVAL);

    await vi.waitFor(() => {
      expect(get(clusterStates)[clusterId1]?.loading).toBe(false);
    });

    expect(collectClusterData).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(WATCHERS_INTERVAL);

      await vi.waitFor(
        () => {
          expect(get(clusterStates)[clusterId1]?.loading).toBe(false);
        },
        { timeout: 1000 },
      );
    }

    expect(collectClusterData).toHaveBeenCalledTimes(4);

    stopGlobalWatcher(clusterId1);

    expect(vi.getTimerCount()).toBe(0);
    expect(get(clusterStates)[clusterId1]).toStrictEqual({
      error: null,
      loading: false,
    });

    vi.advanceTimersByTime(WATCHERS_INTERVAL * 10);
    await vi.runOnlyPendingTimersAsync();

    expect(collectClusterData).toHaveBeenCalledTimes(4);
  });

  it("stopAllWatchers should stop all watchers and clear state", () => {
    setClusterRuntimeContext({ activeClusterId: clusterId1, diagnosticsEnabled: true });
    startGlobalWatcher(clusterId1);
    startGlobalWatcher(clusterId2);

    expect(vi.getTimerCount()).toBe(2);
    expect(Object.keys(get(clusterStates))).toHaveLength(2);

    stopAllWatchers();

    expect(vi.getTimerCount()).toBe(0);
    expect(get(clusterStates)).toEqual({
      [clusterId1]: { loading: false, error: null },
      [clusterId2]: { loading: false, error: null },
    });
  });

  it("clusterStates should update while loading", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });
    let resolvePromise: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    vi.mocked(collectClusterData).mockReturnValueOnce(pendingPromise as any);

    startGlobalWatcher(clusterId1);
    vi.advanceTimersByTime(WATCHERS_INTERVAL);

    expect(get(clusterStates)[clusterId1]?.loading).toBe(true);

    resolvePromise!();

    await pendingPromise;

    expect(get(clusterStates)[clusterId1]?.loading).toBe(false);
  });

  it("interval should keep after error", async () => {
    vi.mocked(collectClusterData)
      .mockRejectedValueOnce(new Error("First fail"))
      .mockResolvedValueOnce({} as any);
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });

    startGlobalWatcher(clusterId1);
    await vi.runOnlyPendingTimersAsync();

    await vi.waitFor(() => {
      expect(get(clusterStates)[clusterId1]).toEqual({
        loading: false,
        error: "First fail",
      });
    });

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("[watcher:global-health] cluster-abc: Error: First fail"),
    );

    await vi.runOnlyPendingTimersAsync();

    await vi.waitFor(() => {
      expect(get(clusterStates)[clusterId1]).toEqual({
        loading: false,
        error: null,
      });
    });

    expect(collectClusterData).toHaveBeenCalledTimes(2);
  });

  it("passes a cancellation guard so in-flight collection can stop after watcher shutdown", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });
    let capturedShouldStop: (() => boolean) | undefined;
    let resolveCollect!: (value: null) => void;
    vi.mocked(collectClusterData).mockImplementation((_clusterId, options) => {
      capturedShouldStop = options?.shouldStop;
      return new Promise((resolve) => {
        resolveCollect = resolve;
      });
    });

    const pending = updateClusterHealthChecks(clusterId1, { force: true });
    await vi.waitFor(() => {
      expect(capturedShouldStop).toEqual(expect.any(Function));
    });
    expect(capturedShouldStop?.()).toBe(false);

    stopGlobalWatcher(clusterId1);
    expect(capturedShouldStop?.()).toBe(true);

    resolveCollect(null);
    await pending;
  });

  it("stops legacy diagnostics watchers when runtime focus moves to another cluster", () => {
    setClusterRuntimeContext({ activeClusterId: clusterId1, diagnosticsEnabled: true });
    startGlobalWatcher(clusterId1);
    startGlobalWatcher(clusterId2);

    expect(vi.getTimerCount()).toBe(2);

    setClusterRuntimeContext({ activeClusterId: clusterId1, diagnosticsEnabled: true });

    expect(vi.getTimerCount()).toBe(1);
    expect(get(clusterStates)[clusterId2]).toEqual({ loading: false, error: null });
  });

  it("skips diagnostics updates for non-active clusters while runtime focus is set", async () => {
    vi.mocked(collectClusterData).mockResolvedValue({} as any);
    setClusterRuntimeContext({ activeClusterId: clusterId1, diagnosticsEnabled: true });

    startGlobalWatcher(clusterId2);
    vi.advanceTimersByTime(WATCHERS_INTERVAL);
    await Promise.resolve();

    expect(collectClusterData).not.toHaveBeenCalled();
  });

  it("runs dashboard diagnostics for all visible clusters when there is no active cluster", async () => {
    vi.mocked(collectClusterData).mockResolvedValue({} as any);
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });

    startGlobalWatcher(clusterId1);
    startGlobalWatcher(clusterId2);
    vi.advanceTimersByTime(WATCHERS_INTERVAL);
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(2);
    expect(collectClusterData).toHaveBeenCalledWith(
      clusterId1,
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );
    expect(collectClusterData).toHaveBeenCalledWith(
      clusterId2,
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );
  });

  it("limits dashboard parallelism using the runtime connection budget", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1, clusterId2],
      diagnosticsEnabled: true,
    });
    setClusterRuntimeBudget({ maxConcurrentConnections: 1 });
    let resolveFirst: (() => void) | undefined;
    vi.mocked(collectClusterData).mockImplementation((clusterId) => {
      if (clusterId === clusterId1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({} as any);
        }) as any;
      }
      return Promise.resolve({} as any);
    });

    startGlobalWatcher(clusterId1);
    startGlobalWatcher(clusterId2);

    vi.advanceTimersByTime(WATCHERS_INTERVAL);
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(1);
    expect(collectClusterData).toHaveBeenCalledWith(
      clusterId1,
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );

    resolveFirst?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(2);
    expect(collectClusterData).toHaveBeenLastCalledWith(
      clusterId2,
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );
  });

  it("stops watchers that are no longer allowed when runtime focus is cleared", () => {
    setClusterRuntimeContext({ activeClusterId: clusterId1, diagnosticsEnabled: true });
    startGlobalWatcher(clusterId1);
    startGlobalWatcher(clusterId2);

    expect(vi.getTimerCount()).toBe(2);

    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId2],
      diagnosticsEnabled: true,
    });

    expect(vi.getTimerCount()).toBe(2);
  });

  it("queues forced refreshes behind an in-flight update", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId2],
      diagnosticsEnabled: true,
    });
    setClusterRuntimeBudget({ maxConcurrentConnections: 1 });
    let resolveFirst: (() => void) | undefined;
    vi.mocked(collectClusterData).mockImplementation((clusterId) => {
      if (clusterId === clusterId1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({} as any);
        }) as any;
      }
      return Promise.resolve({} as any);
    });

    const firstRun = updateClusterHealthChecks(clusterId1, { force: true });
    await Promise.resolve();
    await updateClusterHealthChecks(clusterId2);

    expect(collectClusterData).toHaveBeenCalledTimes(1);
    expect(collectClusterData).toHaveBeenCalledWith(
      clusterId1,
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );

    resolveFirst?.();
    await firstRun;
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(2);
    expect(collectClusterData).toHaveBeenLastCalledWith(
      clusterId2,
      expect.objectContaining({ mode: "dashboard", shouldStop: expect.any(Function) }),
    );
  });

  it("serializes immediate refreshes when multiple dashboard cards open together", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1, clusterId2, "cluster-3"],
      diagnosticsEnabled: true,
    });
    setClusterRuntimeBudget({ maxConcurrentConnections: 1 });
    setKubectlExecutionBudget({ maxConcurrentExecs: 2, maxConcurrentWatches: 2 });

    vi.mocked(collectClusterData).mockImplementation(
      () =>
        new Promise(() => {
          // Keep the first immediate refresh in-flight so sibling cards cannot all burst at once.
        }) as any,
    );

    startGlobalWatcher(clusterId1, 60_000, true);
    startGlobalWatcher(clusterId2, 60_000, true);
    startGlobalWatcher("cluster-3", 60_000, true);

    await Promise.resolve();
    await Promise.resolve();

    expect(collectClusterData).toHaveBeenCalledTimes(1);
    expect(getGlobalWatcherRuntimeSummary()).toEqual(
      expect.objectContaining({
        registeredWatchers: 3,
        activeUpdates: 1,
      }),
    );
    expect(listGlobalWatcherRuntimeRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clusterId: clusterId1, intervalMs: 60_000 }),
        expect.objectContaining({ clusterId: clusterId2, intervalMs: 60_000 }),
        expect.objectContaining({ clusterId: "cluster-3", intervalMs: 60_000 }),
      ]),
    );
  });

  it("allows repeated forced refreshes after the previous forced refresh settles", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1],
      diagnosticsEnabled: true,
    });
    vi.mocked(collectClusterData).mockResolvedValue({} as any);

    await updateClusterHealthChecks(clusterId1, { force: true });
    await updateClusterHealthChecks(clusterId1, { force: true });

    expect(collectClusterData).toHaveBeenCalledTimes(2);
  });

  it("batch-drains multiple pending clusters when concurrency slots free up", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1, clusterId2, "cluster-3"],
      diagnosticsEnabled: true,
    });
    setClusterRuntimeBudget({
      maxConcurrentConnections: 12,
      maxConcurrentClusterRefreshes: 2,
    });
    setKubectlExecutionBudget({ maxConcurrentExecs: 6, maxConcurrentWatches: 2 });

    const resolvers: Array<() => void> = [];
    vi.mocked(collectClusterData).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({} as any));
        }) as any,
    );

    // Start with all three queued via force updates
    startGlobalWatcher(clusterId1, 60_000);
    startGlobalWatcher(clusterId2, 60_000);
    startGlobalWatcher("cluster-3", 60_000);

    void updateClusterHealthChecks(clusterId1, { force: true });
    await Promise.resolve();
    void updateClusterHealthChecks(clusterId2, { force: true });
    await Promise.resolve();
    void updateClusterHealthChecks("cluster-3", { force: true });
    await Promise.resolve();

    // Max 2 concurrent refreshes → 2 should be active, 1 pending
    const summary = getGlobalWatcherRuntimeSummary();
    expect(summary.activeUpdates).toBe(2);
    expect(summary.pendingUpdates).toBe(1);

    // Resolve first cluster → batch drain should pick up the pending one
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const afterDrain = getGlobalWatcherRuntimeSummary();
    expect(afterDrain.activeUpdates).toBe(2);
    expect(afterDrain.pendingUpdates).toBe(0);

    // Clean up
    resolvers.forEach((r) => r());
    await Promise.resolve();
    await Promise.resolve();
  });

  it("exposes runtime summary and rows for synthetic stress panels", async () => {
    setClusterRuntimeContext({
      activeClusterId: null,
      warmClusterIds: [clusterId1, clusterId2],
      diagnosticsEnabled: true,
    });
    setClusterRuntimeBudget({ maxConcurrentConnections: 1 });
    setKubectlExecutionBudget({ maxConcurrentExecs: 2, maxConcurrentWatches: 2 });

    let resolveFirst: (() => void) | undefined;
    vi.mocked(collectClusterData).mockImplementation((clusterId) => {
      if (clusterId === clusterId1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({} as any);
        }) as any;
      }
      return Promise.resolve({} as any);
    });

    startGlobalWatcher(clusterId1, 60_000);
    startGlobalWatcher(clusterId2, 60_000);
    void updateClusterHealthChecks(clusterId1, { force: true });
    await Promise.resolve();
    void updateClusterHealthChecks(clusterId2, { force: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(getGlobalWatcherRuntimeSummary()).toEqual(
      expect.objectContaining({
        registeredWatchers: 2,
        activeUpdates: 1,
        pendingUpdates: 1,
      }),
    );
    expect(listGlobalWatcherRuntimeRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clusterId: clusterId1,
          loading: true,
          intervalMs: 60_000,
        }),
        expect.objectContaining({
          clusterId: clusterId2,
          pending: true,
          intervalMs: 60_000,
        }),
      ]),
    );

    resolveFirst?.();
    await Promise.resolve();
    await Promise.resolve();
  });
});
