import { describe, it, expect, vi, beforeEach } from "vitest";

const startMock = vi.fn();
const stopMock = vi.fn();

vi.mock("../watcher-model", () => {
  return {
    KubectlWatcher: class {
      start = startMock;
      stop = stopMock;
    },
  };
});

describe("pods-watcher", () => {
  beforeEach(() => {
    vi.resetModules();
    startMock.mockClear();
    stopMock.mockClear();
  });

  it("starts watcher for a cluster", async () => {
    const { startPodsWatcher } = await import("./pods-watcher");

    startPodsWatcher("cluster-1");

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(
      "get pods --all-namespaces -o json --watch-only --output-watch-events --request-timeout=300s",
      "cluster-1",
      expect.any(Function),
    );
  });

  it("does not start watcher twice for same cluster", async () => {
    const { startPodsWatcher } = await import("./pods-watcher");

    startPodsWatcher("cluster-1");
    startPodsWatcher("cluster-1");

    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("stops watcher and removes it from active map", async () => {
    const { startPodsWatcher, stopPodsWatcher } = await import("./pods-watcher");

    startPodsWatcher("cluster-1");
    stopPodsWatcher("cluster-1");

    expect(stopMock).toHaveBeenCalledTimes(1);

    stopPodsWatcher("cluster-1");
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it("stopPodsWatcher is safe for unknown cluster", async () => {
    const { stopPodsWatcher } = await import("./pods-watcher");

    stopPodsWatcher("unknown-cluster");

    expect(stopMock).not.toHaveBeenCalled();
  });
});
