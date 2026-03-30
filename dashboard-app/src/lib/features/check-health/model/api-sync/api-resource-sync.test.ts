import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const listMock = vi.fn();
const watchMock = vi.fn();
const emitMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock("$shared/api/kube-api-client", () => ({
  listKubeResource: listMock,
  watchKubeResource: watchMock,
}));

vi.mock("../stream-watchers/event-bus", () => ({
  eventBus: {
    emit: emitMock,
  },
}));

vi.mock("@sentry/sveltekit", () => ({
  captureException: captureExceptionMock,
}));

describe("api-resource-sync", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    listMock.mockReset();
    watchMock.mockReset();
    emitMock.mockReset();
    captureExceptionMock.mockReset();
    const { setActiveApiSyncClusters } = await import("./api-sync-activity");
    setActiveApiSyncClusters(["cluster-a"]);
    const { resetApiCapabilityCache } = await import("./api-capability-cache");
    resetApiCapabilityCache();
    const { resetWatcherTelemetry } = await import("../watcher-telemetry");
    resetWatcherTelemetry();
  });

  it("hydrates initial items and emits non-bookmark watch events", async () => {
    listMock.mockResolvedValue({
      items: [{ metadata: { name: "demo" } }],
      resourceVersion: "10",
    });
    watchMock.mockImplementation(async (options) => {
      options.onEvent({
        type: "ADDED",
        object: { metadata: { name: "demo", resourceVersion: "11" } },
      });
      options.onEvent({
        type: "BOOKMARK",
        object: { metadata: { resourceVersion: "12" } },
      });
      return { expired: false, resourceVersion: "12" };
    });

    const setInitial = vi.fn();
    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync<{ metadata?: { name?: string; resourceVersion?: string } }>({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial,
    });

    sync.start("cluster-a");
    await Promise.resolve();
    await Promise.resolve();

    expect(setInitial).toHaveBeenCalledWith("cluster-a", [{ metadata: { name: "demo" } }]);
    expect(emitMock).toHaveBeenCalledWith({
      clusterId: "cluster-a",
      kind: "pod",
      payload: {
        type: "ADDED",
        object: { metadata: { name: "demo", resourceVersion: "11" } },
      },
    });

    sync.stop("cluster-a");
  });

  it("falls back to legacy watcher start when api sync fails", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    const fallbackStart = vi.fn();

    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/nodes",
      kind: "node",
      setInitial: vi.fn(),
      fallbackStart,
    });

    sync.start("cluster-a");
    await vi.advanceTimersByTimeAsync(2_000);

    await vi.waitFor(() => {
      expect(fallbackStart).toHaveBeenCalledWith("cluster-a");
    });
    sync.stop("cluster-a");
  });

  it("ref-counts subscribers so one cluster session is shared", async () => {
    let resolveList:
      | ((value: {
          items: Array<{ metadata?: { name?: string } }>;
          resourceVersion: string;
        }) => void)
      | undefined;
    listMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial: vi.fn(),
    });

    sync.start("cluster-a");
    sync.start("cluster-a");

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(get(sync.selectRuntimeState("cluster-a")).refCount).toBe(2);

    sync.stop("cluster-a");
    expect(get(sync.selectRuntimeState("cluster-a")).refCount).toBe(1);

    resolveList?.({ items: [], resourceVersion: "10" });
    await Promise.resolve();
    sync.stop("cluster-a");
    expect(get(sync.selectRuntimeState("cluster-a")).refCount).toBe(0);
  });

  it("tries candidate api paths until one lists successfully", async () => {
    listMock.mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce({
      items: [{ metadata: { name: "gateway-a" } }],
      resourceVersion: "21",
    });
    watchMock.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "22" }),
            { once: true },
          );
        }),
    );

    const setInitial = vi.fn();
    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPaths: () => [
        "/apis/gateway.networking.k8s.io/v1/gateways",
        "/apis/gateway.networking.k8s.io/v1beta1/gateways",
      ],
      kind: "configuration",
      setInitial,
    });

    sync.start("cluster-a");
    await Promise.resolve();
    await Promise.resolve();

    expect(listMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: "/apis/gateway.networking.k8s.io/v1/gateways" }),
    );
    expect(listMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: "/apis/gateway.networking.k8s.io/v1beta1/gateways" }),
    );
    await vi.waitFor(() => {
      expect(watchMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/apis/gateway.networking.k8s.io/v1beta1/gateways" }),
      );
    });
    expect(setInitial).toHaveBeenCalledWith("cluster-a", [{ metadata: { name: "gateway-a" } }]);

    sync.stop("cluster-a");
    await Promise.resolve();
  });

  it("skips recently unsupported api paths before retrying candidates", async () => {
    const { markApiPathCapability } = await import("./api-capability-cache");
    markApiPathCapability("cluster-a", "/apis/gateway.networking.k8s.io/v1/gateways", {
      status: "unsupported",
      reason: "the server could not find the requested resource",
    });
    listMock.mockResolvedValue({
      items: [{ metadata: { name: "gateway-a" } }],
      resourceVersion: "21",
    });
    watchMock.mockResolvedValue({ expired: false, resourceVersion: "22" });

    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPaths: () => [
        "/apis/gateway.networking.k8s.io/v1/gateways",
        "/apis/gateway.networking.k8s.io/v1beta1/gateways",
      ],
      kind: "configuration",
      setInitial: vi.fn(),
    });

    sync.start("cluster-a");
    await Promise.resolve();
    await Promise.resolve();

    expect(listMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: "/apis/gateway.networking.k8s.io/v1beta1/gateways" }),
    );
    const { listWatcherTelemetryEvents, getWatcherHealthSnapshot } = await import(
      "../watcher-telemetry"
    );
    expect(listWatcherTelemetryEvents().some((event) => event.name === "path_skipped")).toBe(true);
    expect(getWatcherHealthSnapshot().pathSkippedCount).toBe(1);

    sync.stop("cluster-a");
  });

  it("records runtime watcher telemetry for start, relist and stop", async () => {
    listMock
      .mockResolvedValueOnce({
        items: [{ metadata: { name: "demo" } }],
        resourceVersion: "10",
      })
      .mockResolvedValueOnce({
        items: [{ metadata: { name: "demo" } }],
        resourceVersion: "12",
      });
    watchMock.mockResolvedValueOnce({ expired: true, resourceVersion: "11" }).mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "12" }),
            { once: true },
          );
        }),
    );

    const { createApiResourceSync } = await import("./api-resource-sync");
    const { listWatcherTelemetryEvents, getWatcherHealthSnapshot } = await import(
      "../watcher-telemetry"
    );
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial: vi.fn(),
    });

    sync.start("cluster-a");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    sync.stop("cluster-a");
    await Promise.resolve();

    expect(listWatcherTelemetryEvents().map((event) => event.name)).toContain("session_start");
    expect(listWatcherTelemetryEvents().map((event) => event.name)).toContain("watch_relist");
    expect(listWatcherTelemetryEvents().map((event) => event.name)).toContain("session_stop");
    expect(getWatcherHealthSnapshot().relistCount).toBe(1);
  });

  it("starts stream sessions only for active clusters", async () => {
    listMock.mockResolvedValue({
      items: [{ metadata: { name: "demo" } }],
      resourceVersion: "10",
    });
    watchMock.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "11" }),
            { once: true },
          );
        }),
    );

    const { setActiveApiSyncClusters, resetActiveApiSyncClusters } = await import(
      "./api-sync-activity"
    );
    resetActiveApiSyncClusters();

    const setInitial = vi.fn();
    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial,
    });

    sync.start("cluster-a");
    await Promise.resolve();
    expect(listMock).not.toHaveBeenCalled();
    expect(get(sync.selectRuntimeState("cluster-a")).isRunning).toBe(false);
    expect(get(sync.selectRuntimeState("cluster-a")).refCount).toBe(1);

    setActiveApiSyncClusters(["cluster-a"]);
    await vi.waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(setInitial).toHaveBeenCalledWith("cluster-a", [{ metadata: { name: "demo" } }]);
    });

    sync.stop("cluster-a");
    resetActiveApiSyncClusters();
  });

  it("suspends active sessions when a cluster becomes inactive", async () => {
    listMock.mockResolvedValue({
      items: [{ metadata: { name: "demo" } }],
      resourceVersion: "10",
    });
    watchMock.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "11" }),
            { once: true },
          );
        }),
    );

    const { setActiveApiSyncClusters, resetActiveApiSyncClusters } = await import(
      "./api-sync-activity"
    );
    setActiveApiSyncClusters(["cluster-a"]);

    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial: vi.fn(),
    });

    sync.start("cluster-a");
    await vi.waitFor(() => {
      expect(watchMock).toHaveBeenCalledTimes(1);
    });

    setActiveApiSyncClusters([]);
    await vi.waitFor(() => {
      expect(get(sync.selectRuntimeState("cluster-a")).isRunning).toBe(false);
    });
    expect(get(sync.selectRuntimeState("cluster-a")).refCount).toBe(1);
    expect(get(sync.selectRuntimeState("cluster-a")).transport).toBe("idle");

    sync.stop("cluster-a");
    resetActiveApiSyncClusters();
  });

  it("tracks relists when watch expires with 410 semantics", async () => {
    listMock
      .mockResolvedValueOnce({
        items: [{ metadata: { name: "demo" } }],
        resourceVersion: "10",
      })
      .mockResolvedValueOnce({
        items: [{ metadata: { name: "demo-2" } }],
        resourceVersion: "11",
      });
    watchMock.mockResolvedValueOnce({ expired: true, resourceVersion: "10" });

    const setInitial = vi.fn();
    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial,
    });

    sync.start("cluster-a");
    await vi.waitFor(() => {
      expect(get(sync.selectRuntimeState("cluster-a")).relistCount).toBe(1);
    });
    expect(setInitial).toHaveBeenLastCalledWith("cluster-a", [{ metadata: { name: "demo-2" } }]);

    sync.stop("cluster-a");
  });

  it("retries transient api failures with backoff before falling back", async () => {
    listMock.mockRejectedValueOnce(new Error("connection refused")).mockResolvedValueOnce({
      items: [{ metadata: { name: "demo" } }],
      resourceVersion: "10",
    });
    watchMock.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "11" }),
            { once: true },
          );
        }),
    );
    const fallbackStart = vi.fn();

    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial: vi.fn(),
      fallbackStart,
    });

    sync.start("cluster-a");
    await vi.waitFor(() => {
      expect(get(sync.selectRuntimeState("cluster-a")).retryCount).toBe(1);
    });
    expect(fallbackStart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    await Promise.resolve();

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(fallbackStart).not.toHaveBeenCalled();

    sync.stop("cluster-a");
    await Promise.resolve();
  });
});
