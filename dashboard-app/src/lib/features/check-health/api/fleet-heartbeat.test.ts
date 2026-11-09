import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";

const mockKubectlRawFront = vi.fn();

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: (...args: unknown[]) => mockKubectlRawFront(...args),
}));
vi.mock("$features/check-health/model/watchers", () => ({
  clusterStates: writable<Record<string, { loading: boolean; error: string | null }>>({}),
  restartWatcherForCluster: vi.fn(),
}));
vi.mock("$features/check-health/model/feature-capability-cache", () => ({
  getFeatureCapability: () => null,
}));
vi.mock("$shared/lib/runtime-debug", () => ({
  writeRuntimeDebugLog: vi.fn(async () => {}),
}));
vi.mock("$widgets/datalists/ui/model/overview-diagnostics", () => ({
  isAuthError: () => false,
}));

import { startFleetHeartbeat, stopFleetHeartbeat } from "./fleet-heartbeat";

// The heartbeat runs each managed cluster's credentials (and so its exec plugin).
// These tests pin the two facts the first-screen contract relies on: it never
// starts without managed clusters, and even with them nothing runs at start.
describe("fleet heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockKubectlRawFront.mockReset();
    mockKubectlRawFront.mockResolvedValue({ output: "ok", errors: "", code: 0 });
  });

  afterEach(() => {
    stopFleetHeartbeat();
    vi.useRealTimers();
  });

  it("does nothing when there are no managed clusters", async () => {
    startFleetHeartbeat([]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(mockKubectlRawFront).not.toHaveBeenCalled();
  });

  it("probes nothing at start; the first /healthz goes out 30 s later", async () => {
    startFleetHeartbeat(["c1", "c2"]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(mockKubectlRawFront).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockKubectlRawFront).toHaveBeenCalledTimes(2);
    expect(mockKubectlRawFront).toHaveBeenCalledWith("get --raw=/healthz --request-timeout=5s", {
      clusterId: "c1",
    });
  });

  it("stops cleanly before the first cycle", async () => {
    startFleetHeartbeat(["c1"]);
    stopFleetHeartbeat();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mockKubectlRawFront).not.toHaveBeenCalled();
  });
});
