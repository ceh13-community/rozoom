import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { WatchLifecycleHooks } from "../stream-watchers/watcher-model";

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
    // The api retry backoff adds 0-499 ms of jitter. With a random value near 0 the
    // fallback started 1.0 s into the 2 s setup, and its 60 s api retry landed exactly on
    // the 59 s mark the retry test checks: list ran a third time ("expected 3 to be 2").
    // A fixed value makes every timer in this suite land at the same time on every run.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
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
      expect(fallbackStart).toHaveBeenCalledWith(
        "cluster-a",
        expect.objectContaining({ onGiveUp: expect.any(Function) }),
      );
    });
    sync.stop("cluster-a");
  });

  it("keeps a running fallback instead of retrying the api on every activity update", async () => {
    listMock.mockRejectedValue(new Error("Load failed"));
    const fallbackStart = vi.fn();
    const fallbackStop = vi.fn();

    const { setActiveApiSyncClusters } = await import("./api-sync-activity");
    const { createApiResourceSync, selectResourceStreamLive } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/services",
      kind: "configuration",
      scope: "configuration:services",
      setInitial: vi.fn(),
      fallbackStart,
      fallbackStop,
    });
    const live = selectResourceStreamLive("configuration:services", "cluster-a");

    sync.start("cluster-a");
    expect(get(live)).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(fallbackStart).toHaveBeenCalledTimes(1);
    });
    const listCallsAtFallback = listMock.mock.calls.length;
    // Not live until the fallback delivered its first full list.
    expect(get(live)).toBe(false);
    const hooks = fallbackStart.mock.calls[0]?.[1] as WatchLifecycleHooks;
    hooks.onRelist?.([]);
    expect(get(live)).toBe(true);
    expect(get(sync.selectRuntimeState("cluster-a")).transport).toBe("fallback");

    // Unrelated runtime context changes re-emit the active cluster list.
    setActiveApiSyncClusters(["cluster-a"]);
    setActiveApiSyncClusters(["cluster-a"]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(listMock.mock.calls.length).toBe(listCallsAtFallback);
    expect(fallbackStop).not.toHaveBeenCalled();
    expect(get(live)).toBe(true);

    sync.stop("cluster-a");
    expect(fallbackStop).toHaveBeenCalledWith("cluster-a");
    expect(get(live)).toBe(false);
  });

  async function startOnFallback() {
    listMock.mockRejectedValue(new Error("Load failed"));
    const fallbackStart = vi.fn();
    const fallbackStop = vi.fn();
    const setInitial = vi.fn();
    const { createApiResourceSync, selectResourceStreamLive } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/secrets",
      kind: "configuration",
      scope: "configuration:secrets",
      setInitial,
      fallbackStart,
      fallbackStop,
    });
    const live = selectResourceStreamLive("configuration:secrets", "cluster-a");
    sync.start("cluster-a");
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(fallbackStart).toHaveBeenCalledTimes(1);
    });
    const hooks = () =>
      fallbackStart.mock.calls[fallbackStart.mock.calls.length - 1]?.[1] as WatchLifecycleHooks;
    return { sync, live, fallbackStart, fallbackStop, setInitial, hooks };
  }

  it("shows a fallback stream that gave up as not live", async () => {
    const { sync, live, setInitial, hooks } = await startOnFallback();
    hooks().onRelist?.([{ metadata: { name: "s1" } }]);
    expect(setInitial).toHaveBeenLastCalledWith("cluster-a", [{ metadata: { name: "s1" } }]);
    expect(get(live)).toBe(true);

    // kubectl get --watch fails (403, expired token) until the watcher stops restarting.
    hooks().onGiveUp?.("watch stream exited 6 times without a successful event");

    expect(get(live)).toBe(false);
    expect(get(sync.selectRuntimeState("cluster-a")).error).toContain("exited 6 times");
    sync.stop("cluster-a");
  });

  it("retries the api from the fallback on a timer and hands over when it works", async () => {
    const { sync, live, fallbackStop, hooks } = await startOnFallback();
    hooks().onRelist?.([]);
    const listCalls = listMock.mock.calls.length;

    // The fallback started 1.25 s in (1 s backoff + 250 ms jitter); its api retry is due
    // 60 s later, at 61.25 s. Setup ended at 2 s: at 60 s nothing has run yet.
    await vi.advanceTimersByTimeAsync(58_000);
    expect(listMock.mock.calls.length).toBe(listCalls);

    listMock.mockResolvedValue({ items: [{ metadata: { name: "s1" } }], resourceVersion: "20" });
    watchMock.mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "21" }),
            { once: true },
          );
        }),
    );
    await vi.advanceTimersByTimeAsync(1_500);

    await vi.waitFor(() => {
      expect(fallbackStop).toHaveBeenCalledWith("cluster-a");
    });
    expect(get(sync.selectRuntimeState("cluster-a")).transport).toBe("api");
    expect(get(live)).toBe(true);
    sync.stop("cluster-a");
  });

  it("restarts a fallback that gave up when the api retry fails too", async () => {
    const { sync, live, fallbackStart, fallbackStop, hooks } = await startOnFallback();
    hooks().onGiveUp?.("watch stream exited 6 times without a successful event");
    expect(get(live)).toBe(false);

    await vi.advanceTimersByTimeAsync(61_000);

    await vi.waitFor(() => {
      expect(fallbackStart).toHaveBeenCalledTimes(2);
    });
    expect(fallbackStop).toHaveBeenCalledTimes(1);
    // The restarted watch is live only after its own list.
    expect(get(live)).toBe(false);
    hooks().onRelist?.([]);
    expect(get(live)).toBe(true);

    // The next api retry backs off to 120 s.
    const listCalls = listMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100_000);
    expect(listMock.mock.calls.length).toBe(listCalls);
    sync.stop("cluster-a");
  });

  it("does not open a watch when the list has no resourceVersion to start from", async () => {
    listMock.mockResolvedValue({ items: [], resourceVersion: "" });

    const { createApiResourceSync } = await import("./api-resource-sync");
    const sync = createApiResourceSync({
      getPath: () => "/api/v1/pods",
      kind: "pod",
      setInitial: vi.fn(),
    });
    sync.start("cluster-a");

    await vi.waitFor(() => {
      expect(get(sync.selectRuntimeState("cluster-a")).error).toContain("no resourceVersion");
    });
    expect(watchMock).not.toHaveBeenCalled();
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

  it("delivers configuration events in the payload shape the configuration store reads", async () => {
    vi.doUnmock("../stream-watchers/event-bus");
    const { eventBus } = await import("../stream-watchers/event-bus");
    const { initConfigurationSync, destroyConfigurationSync } = await import(
      "../stream-watchers/configuration/configuration-sync"
    );
    const { selectClusterConfigurationItems } = await import(
      "../stream-watchers/configuration/configuration-store"
    );
    const service = (name: string, resourceVersion: string) => ({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name, namespace: "probe", uid: `uid-${name}`, resourceVersion },
    });
    listMock.mockResolvedValue({ items: [service("svc-a", "10")], resourceVersion: "10" });
    const watch: { push?: (event: unknown) => void } = {};
    watchMock.mockImplementation(
      ({ signal, onEvent }) =>
        new Promise((resolve) => {
          watch.push = onEvent;
          signal.addEventListener(
            "abort",
            () => resolve({ expired: false, resourceVersion: "12" }),
            { once: true },
          );
        }),
    );
    const received: unknown[] = [];
    const unsubscribe = eventBus.subscribe((event) => {
      if (event.kind === "configuration") received.push(event.payload);
    });

    initConfigurationSync("cluster-a", "services", []);
    await vi.waitFor(() => {
      expect(watch.push).toBeDefined();
    });
    watch.push?.({ type: "ADDED", object: service("svc-b", "11") });
    watch.push?.({ type: "DELETED", object: service("svc-a", "12") });

    expect(received).toEqual([
      { workloadType: "services", event: { type: "ADDED", object: service("svc-b", "11") } },
      { workloadType: "services", event: { type: "DELETED", object: service("svc-a", "12") } },
    ]);
    const names = get(selectClusterConfigurationItems("cluster-a", "services")).map(
      (item) => (item as { metadata?: { name?: string } }).metadata?.name,
    );
    expect(names).toEqual(["svc-b"]);

    unsubscribe();
    destroyConfigurationSync("cluster-a", "services");
  });
});
