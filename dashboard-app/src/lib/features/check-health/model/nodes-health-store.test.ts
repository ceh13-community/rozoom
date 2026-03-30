import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { get } from "svelte/store";
import {
  resetClusterRuntimeContext,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";
import {
  startNodesHealthPolling,
  stopNodesHealthPolling,
  selectClusterNodesHealth,
} from "./nodes-health-store";
import * as checkNodeHealth from "../api/check-node-health";
import type { NodeHealth } from "../api/check-node-health";

vi.mock("../api/check-node-health");

describe("nodes-health-store", () => {
  const mockClusterId = "test-cluster-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetClusterRuntimeContext();
    setClusterRuntimeContext({ activeClusterId: mockClusterId, diagnosticsEnabled: true });
    stopNodesHealthPolling(mockClusterId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    stopNodesHealthPolling(mockClusterId);
    resetClusterRuntimeContext();
  });

  const createMockHealth = (name: string): NodeHealth => ({
    name,
    cpuUsage: "50%",
    memoryUsage: "60%",
    diskUsage: "100.00 GiB",
  });

  describe("startNodesHealthPolling", () => {
    it("should start polling and fetch health data", async () => {
      const mockData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      startNodesHealthPolling(mockClusterId);

      const store = selectClusterNodesHealth(mockClusterId);
      let state = get(store);

      expect(state.isLoading).toBe(false);
      expect(state.data).toEqual([]);

      await vi.advanceTimersByTimeAsync(3_000);

      state = get(store);
      expect(state.data).toEqual(mockData);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastUpdatedAt).toBeGreaterThan(0);
    });

    it("should use custom poll interval", async () => {
      const mockData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      const customPollMs = 5000;
      startNodesHealthPolling(mockClusterId, customPollMs);

      await vi.advanceTimersByTimeAsync(3_000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(customPollMs + 2000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(2);
    });

    it("should increment refCount when started multiple times", async () => {
      const mockData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      startNodesHealthPolling(mockClusterId);
      startNodesHealthPolling(mockClusterId);
      startNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(3_000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();

      stopNodesHealthPolling(mockClusterId);
      vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

      await vi.advanceTimersByTimeAsync(25000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();
    });

    it("should handle single NodeHealth result", async () => {
      const mockData = createMockHealth("node-1");
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      startNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      const state = get(selectClusterNodesHealth(mockClusterId));
      expect(state.data).toEqual([mockData]);
    });

    it("should handle undefined result", async () => {
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(undefined);

      startNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      const state = get(selectClusterNodesHealth(mockClusterId));
      expect(state.data).toEqual([]);
    });

    it("should set loading state during fetch", async () => {
      let resolveHealth: ((value: NodeHealth[]) => void) | undefined;
      const healthPromise = new Promise<NodeHealth[]>((resolve) => {
        resolveHealth = resolve;
      });

      vi.mocked(checkNodeHealth.checkNodesHealth).mockReturnValue(healthPromise);

      startNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      const state = get(selectClusterNodesHealth(mockClusterId));
      expect(state.isLoading).toBe(true);

      resolveHealth!([createMockHealth("node-1")]);
      await vi.advanceTimersByTimeAsync(100);

      const finalState = get(selectClusterNodesHealth(mockClusterId));
      expect(finalState.isLoading).toBe(false);
    });

    it("should handle errors and set error state", async () => {
      vi.mocked(checkNodeHealth.checkNodesHealth).mockRejectedValue(new Error("Connection failed"));

      startNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      const state = get(selectClusterNodesHealth(mockClusterId));
      expect(state.error).toBe("Connection failed");
      expect(state.isLoading).toBe(false);
    });

    it("should handle non-Error exceptions", async () => {
      vi.mocked(checkNodeHealth.checkNodesHealth).mockRejectedValue("String error");

      startNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      const state = get(selectClusterNodesHealth(mockClusterId));
      expect(state.error).toBe("Unknown error");
    });

    it("preserves last known metrics snapshot when polling restarts", async () => {
      const firstData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(firstData);

      startNodesHealthPolling(mockClusterId);
      await vi.advanceTimersByTimeAsync(2000);

      const snapshotBeforeRestart = get(selectClusterNodesHealth(mockClusterId));
      expect(snapshotBeforeRestart.data).toEqual(firstData);

      stopNodesHealthPolling(mockClusterId);
      startNodesHealthPolling(mockClusterId, 5000);

      const stateAfterRestart = get(selectClusterNodesHealth(mockClusterId));
      expect(stateAfterRestart.data).toEqual(firstData);
      expect(stateAfterRestart.enabled).toBe(true);
    });

    // it("should apply exponential backoff on errors", async () => {
    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockRejectedValue(new Error("Network error"));

    //   startNodesHealthPolling(mockClusterId, 10000);

    //   await vi.advanceTimersByTimeAsync(2000);
    //   await vi.advanceTimersByTimeAsync(100);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);

    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

    //   await vi.advanceTimersByTimeAsync(4000);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(0);

    //   await vi.advanceTimersByTimeAsync(3000);
    //   await vi.advanceTimersByTimeAsync(100);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);

    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

    //   await vi.advanceTimersByTimeAsync(9000);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(0);

    //   await vi.advanceTimersByTimeAsync(3000);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);
    // });

    // it("should reset backoff on success after error", async () => {
    //   vi.mocked(checkNodeHealth.checkNodesHealth)
    //     .mockRejectedValueOnce(new Error("Error"))
    //     .mockResolvedValue([createMockHealth("node-1")]);

    //   startNodesHealthPolling(mockClusterId, 10000);

    //   await vi.advanceTimersByTimeAsync(2000);

    //   await vi.advanceTimersByTimeAsync(7000);

    //   await vi.advanceTimersByTimeAsync(2000);

    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();
    //   await vi.advanceTimersByTimeAsync(12000);

    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();
    // });

    // it("should cap backoff at 60 seconds", async () => {
    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockRejectedValue(new Error("Error"));

    //   startNodesHealthPolling(mockClusterId, 1000);

    //   for (let i = 0; i < 10; i++) {
    //     await vi.advanceTimersByTimeAsync(2000);
    //     await vi.advanceTimersByTimeAsync(65000);
    //   }

    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

    //   await vi.advanceTimersByTimeAsync(60000);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(0);

    //   await vi.advanceTimersByTimeAsync(2000);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();
    // });

    // it("should not start new request when one is in flight", async () => {
    //   let resolveHealth: ((value: NodeHealth[]) => void) | undefined;
    //   const healthPromise = new Promise<NodeHealth[]>((resolve) => {
    //     resolveHealth = resolve;
    //   });

    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockReturnValue(healthPromise);

    //   startNodesHealthPolling(mockClusterId, 1000);

    //   await vi.advanceTimersByTimeAsync(2000);

    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);

    //   await vi.advanceTimersByTimeAsync(10000);

    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);

    //   resolveHealth!([createMockHealth("node-1")]);
    //   await vi.advanceTimersByTimeAsync(100);

    //   await vi.advanceTimersByTimeAsync(2000);
    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(2);
    // });
  });

  describe("stopNodesHealthPolling", () => {
    // it("should stop polling after all refs are removed", async () => {
    //   const mockData = [createMockHealth("node-1")];
    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

    //   startNodesHealthPolling(mockClusterId);

    //   await vi.advanceTimersByTimeAsync(2000);

    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();

    //   stopNodesHealthPolling(mockClusterId);

    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

    //   await vi.advanceTimersByTimeAsync(30000);

    //   expect(checkNodeHealth.checkNodesHealth).not.toHaveBeenCalled();
    // });

    it("should decrement refCount and continue polling", async () => {
      const mockData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      startNodesHealthPolling(mockClusterId);
      startNodesHealthPolling(mockClusterId);
      startNodesHealthPolling(mockClusterId);

      stopNodesHealthPolling(mockClusterId);
      stopNodesHealthPolling(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();

      vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

      await vi.advanceTimersByTimeAsync(25000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();
    });

    it("should handle stopping non-existent cluster", () => {
      stopNodesHealthPolling("non-existent");
    });

    it("should handle multiple stops", () => {
      startNodesHealthPolling(mockClusterId);

      stopNodesHealthPolling(mockClusterId);
      stopNodesHealthPolling(mockClusterId);
      stopNodesHealthPolling(mockClusterId);
    });
  });

  describe("selectClusterNodesHealth", () => {
    it("should return store for cluster", async () => {
      const mockData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      startNodesHealthPolling(mockClusterId);

      const store = selectClusterNodesHealth(mockClusterId);

      await vi.advanceTimersByTimeAsync(2000);

      const state = get(store);
      expect(state.data).toEqual(mockData);
    });

    it("should return default state for non-existent cluster", () => {
      const store = selectClusterNodesHealth("non-existent");
      const state = get(store);

      expect(state).toEqual({
        enabled: false,
        data: [],
        lastUpdatedAt: null,
        isLoading: false,
        error: null,
      });
    });

    //   it("should react to store updates", async () => {
    //     const mockData1 = [createMockHealth("node-1")];
    //     const mockData2 = [createMockHealth("node-1"), createMockHealth("node-2")];

    //     vi.mocked(checkNodeHealth.checkNodesHealth)
    //       .mockResolvedValueOnce(mockData1)
    //       .mockResolvedValueOnce(mockData2);

    //     startNodesHealthPolling(mockClusterId, 5000);

    //     const store = selectClusterNodesHealth(mockClusterId);

    //     await vi.runAllTimersAsync();

    //     expect(get(store).data).toEqual(mockData1);

    //     await vi.advanceTimersByTimeAsync(7000);

    //     expect(get(store).data).toEqual(mockData2);
    //   });
  });

  describe("multiple clusters", () => {
    it("runs nodes diagnostics only for the active runtime cluster", async () => {
      const cluster1 = "cluster-1";
      const cluster2 = "cluster-2";

      setClusterRuntimeContext({ activeClusterId: cluster1, diagnosticsEnabled: true });
      vi.mocked(checkNodeHealth.checkNodesHealth).mockImplementation(async (id) => {
        if (id === cluster1) return [createMockHealth("node-1")];
        if (id === cluster2) return [createMockHealth("node-2")];
        return [];
      });

      startNodesHealthPolling(cluster1);
      startNodesHealthPolling(cluster2);

      await vi.advanceTimersByTimeAsync(2000);

      const state1 = get(selectClusterNodesHealth(cluster1));
      const state2 = get(selectClusterNodesHealth(cluster2));

      expect(state1.data[0].name).toBe("node-1");
      expect(state2.data).toEqual([]);

      stopNodesHealthPolling(cluster1);
      stopNodesHealthPolling(cluster2);
    });

    it("restarts polling when runtime focus switches to another cluster", async () => {
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue([]);

      setClusterRuntimeContext({ activeClusterId: "cluster-1", diagnosticsEnabled: true });
      startNodesHealthPolling("cluster-1");
      startNodesHealthPolling("cluster-2");
      startNodesHealthPolling("cluster-3");

      await vi.advanceTimersByTimeAsync(2000);
      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);
      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledWith("cluster-1");

      vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();
      setClusterRuntimeContext({ activeClusterId: "cluster-3", diagnosticsEnabled: true });
      await vi.advanceTimersByTimeAsync(2000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);
      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledWith("cluster-3");

      stopNodesHealthPolling("cluster-1");
      stopNodesHealthPolling("cluster-2");
      stopNodesHealthPolling("cluster-3");
    });
  });

  describe("edge cases", () => {
    // it("should handle very short poll intervals", async () => {
    //   const mockData = [createMockHealth("node-1")];
    //   vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

    //   startNodesHealthPolling(mockClusterId, 100);

    //   await vi.advanceTimersByTimeAsync(500);

    //   expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(2);
    // });

    it("should update pollMs when restarted with different interval", async () => {
      const mockData = [createMockHealth("node-1")];
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue(mockData);

      startNodesHealthPolling(mockClusterId, 10000);
      startNodesHealthPolling(mockClusterId, 5000);

      await vi.advanceTimersByTimeAsync(2000);

      vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

      await vi.advanceTimersByTimeAsync(7000);

      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalled();
    });

    it("should apply random jitter to prevent thundering herd", async () => {
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue([]);

      const mathRandomSpy = vi.spyOn(Math, "random");

      startNodesHealthPolling(mockClusterId);

      expect(mathRandomSpy).toHaveBeenCalled();

      mathRandomSpy.mockRestore();
    });

    it("pauses polling when diagnostics runtime becomes inactive", async () => {
      vi.mocked(checkNodeHealth.checkNodesHealth).mockResolvedValue([createMockHealth("node-1")]);

      startNodesHealthPolling(mockClusterId, 5_000);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);

      setClusterRuntimeContext({ activeClusterId: null });
      vi.mocked(checkNodeHealth.checkNodesHealth).mockClear();

      await vi.advanceTimersByTimeAsync(10_000);
      expect(checkNodeHealth.checkNodesHealth).not.toHaveBeenCalled();

      setClusterRuntimeContext({ activeClusterId: mockClusterId, diagnosticsEnabled: true });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(checkNodeHealth.checkNodesHealth).toHaveBeenCalledTimes(1);
    });
  });
});
