import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnCliMock = vi.fn();
const appDataDirMock = vi.fn().mockResolvedValue("/tmp/appdata");

vi.mock("./cli", () => ({
  spawnCli: spawnCliMock,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: appDataDirMock,
}));

type Handlers = {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onClose?: () => void;
};

/** Every kubectl proxy the module starts, with its handlers and its kill mock. */
function trackSpawns() {
  const spawned: { handlers: Handlers; kill: ReturnType<typeof vi.fn> }[] = [];
  spawnCliMock.mockImplementation(async (_tool: string, _args: string[], handlers: Handlers) => {
    const kill = vi.fn().mockResolvedValue(undefined);
    spawned.push({ handlers, kill });
    return { command: {} as never, child: { kill } as never };
  });
  const serve = (index: number, port: number) =>
    spawned[index]?.handlers.onStdoutLine?.(`Starting to serve on 127.0.0.1:${port}`);
  const alive = () => spawned.filter((proxy) => proxy.kill.mock.calls.length === 0).length;
  return { spawned, serve, alive };
}

describe("kube-api-proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnCliMock.mockReset();
    appDataDirMock.mockClear();
  });

  it("starts a shared kubectl proxy and reuses it per cluster", async () => {
    const { spawned, serve } = trackSpawns();
    const { acquireKubeApiProxy, releaseKubeApiProxy, getActiveKubeApiProxyCount } = await import(
      "./kube-api-proxy"
    );

    const pending = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    serve(0, 39123);
    const first = await pending;
    expect(first.baseUrl).toBe("http://127.0.0.1:39123");

    const second = await acquireKubeApiProxy("cluster-a");
    expect(second.baseUrl).toBe("http://127.0.0.1:39123");
    expect(spawnCliMock).toHaveBeenCalledTimes(1);
    // Read-only by construction: the guard allows `proxy` only with this flag.
    expect(spawnCliMock.mock.calls[0]?.[1]).toContain("--reject-methods=^(POST|PUT|PATCH|DELETE)$");
    expect(getActiveKubeApiProxyCount()).toBe(1);

    await releaseKubeApiProxy(first);
    // Releasing the same lease twice counts once.
    await releaseKubeApiProxy(first);
    expect(spawned[0]?.kill).not.toHaveBeenCalled();

    await releaseKubeApiProxy(second);
    expect(spawned[0]?.kill).toHaveBeenCalledTimes(1);
  });

  it("starts one proxy for callers that ask at the same time", async () => {
    const { spawned, serve, alive } = trackSpawns();
    const { acquireKubeApiProxy, releaseKubeApiProxy, getActiveKubeApiProxyCount } = await import(
      "./kube-api-proxy"
    );

    // Pods, Nodes, Replica Sets and others sync from separate stores and start together.
    const pending = [acquireKubeApiProxy("cluster-a"), acquireKubeApiProxy("cluster-a")];
    await vi.waitFor(() => expect(spawned.length).toBeGreaterThan(0));
    serve(0, 39001);
    const leases = await Promise.all(pending);

    expect(spawned).toHaveLength(1);
    expect(leases.map((lease) => lease.baseUrl)).toEqual([
      "http://127.0.0.1:39001",
      "http://127.0.0.1:39001",
    ]);

    await releaseKubeApiProxy(leases[0]!);
    expect(alive()).toBe(1);
    await releaseKubeApiProxy(leases[1]!);
    expect(alive()).toBe(0);
    expect(getActiveKubeApiProxyCount()).toBe(0);
  });

  it("keeps the newer proxy when the stopped one reports its exit late", async () => {
    const { spawned, serve } = trackSpawns();
    const { acquireKubeApiProxy, releaseKubeApiProxy, getActiveKubeApiProxyCount } = await import(
      "./kube-api-proxy"
    );

    const firstPending = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    serve(0, 39001);
    await releaseKubeApiProxy(await firstPending);
    expect(spawned[0]?.kill).toHaveBeenCalledTimes(1);

    const secondPending = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(2));
    serve(1, 39002);
    const second = await secondPending;

    // The first proxy's exit arrives only now, after the second one took its place.
    spawned[0]?.handlers.onClose?.();

    expect(getActiveKubeApiProxyCount()).toBe(1);
    const third = await acquireKubeApiProxy("cluster-a");
    expect(third.baseUrl).toBe("http://127.0.0.1:39002");
    expect(spawnCliMock).toHaveBeenCalledTimes(2);

    await releaseKubeApiProxy(second);
    await releaseKubeApiProxy(third);
    expect(spawned[1]?.kill).toHaveBeenCalledTimes(1);
    expect(getActiveKubeApiProxyCount()).toBe(0);
  });

  it("does not stop a newer proxy when a caller of an exited one releases", async () => {
    const { spawned, serve } = trackSpawns();
    const { acquireKubeApiProxy, releaseKubeApiProxy } = await import("./kube-api-proxy");

    const oldPending = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    serve(0, 39001);
    const oldLease = await oldPending;

    // The first proxy exits on its own while its caller still holds it.
    spawned[0]?.handlers.onClose?.();

    const newPending = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(2));
    serve(1, 39002);
    const newLease = await newPending;

    await releaseKubeApiProxy(oldLease);
    expect(spawned[1]?.kill).not.toHaveBeenCalled();

    await releaseKubeApiProxy(newLease);
    expect(spawned[1]?.kill).toHaveBeenCalledTimes(1);
  });

  it("stops a proxy whose start failed after the process was spawned", async () => {
    const { spawned } = trackSpawns();
    const { acquireKubeApiProxy, getActiveKubeApiProxyCount } = await import("./kube-api-proxy");

    const pending = [acquireKubeApiProxy("cluster-a"), acquireKubeApiProxy("cluster-a")];
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0]?.handlers.onStderrLine?.("error: You must be logged in to the server");

    for (const attempt of pending) {
      await expect(attempt).rejects.toThrow("You must be logged in to the server");
    }
    expect(spawned[0]?.kill).toHaveBeenCalledTimes(1);
    expect(getActiveKubeApiProxyCount()).toBe(0);
  });
});
