import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnCliMock = vi.fn();
const appDataDirMock = vi.fn().mockResolvedValue("/tmp/appdata");

vi.mock("./cli", () => ({
  spawnCli: spawnCliMock,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: appDataDirMock,
}));

describe("kube-api-proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnCliMock.mockReset();
    appDataDirMock.mockClear();
  });

  it("starts a shared kubectl proxy and reuses it per cluster", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    let stdoutHandler: ((line: string) => void) | undefined;

    spawnCliMock.mockImplementation(async (_tool, _args, handlers) => {
      stdoutHandler = handlers?.onStdoutLine;
      return {
        command: {} as never,
        child: { kill } as never,
      };
    });

    const { acquireKubeApiProxy, releaseKubeApiProxy, getActiveKubeApiProxyCount } = await import(
      "./kube-api-proxy"
    );

    const first = acquireKubeApiProxy("cluster-a");
    await Promise.resolve();
    stdoutHandler?.("Starting to serve on 127.0.0.1:39123");
    await expect(first).resolves.toBe("http://127.0.0.1:39123");

    await expect(acquireKubeApiProxy("cluster-a")).resolves.toBe("http://127.0.0.1:39123");
    expect(spawnCliMock).toHaveBeenCalledTimes(1);
    // Read-only by construction: the guard allows `proxy` only with this flag.
    expect(spawnCliMock.mock.calls[0]?.[1]).toContain("--reject-methods=^(POST|PUT|PATCH|DELETE)$");
    expect(getActiveKubeApiProxyCount()).toBe(1);

    await releaseKubeApiProxy("cluster-a");
    expect(kill).not.toHaveBeenCalled();

    await releaseKubeApiProxy("cluster-a");
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer proxy when the stopped one reports its exit late", async () => {
    type Handlers = { onStdoutLine?: (line: string) => void; onClose?: () => void };
    const spawned: { handlers: Handlers; kill: ReturnType<typeof vi.fn> }[] = [];
    spawnCliMock.mockImplementation(async (_tool, _args, handlers: Handlers) => {
      const kill = vi.fn().mockResolvedValue(undefined);
      spawned.push({ handlers, kill });
      return { command: {} as never, child: { kill } as never };
    });

    const { acquireKubeApiProxy, releaseKubeApiProxy, getActiveKubeApiProxyCount } = await import(
      "./kube-api-proxy"
    );

    const first = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0]?.handlers.onStdoutLine?.("Starting to serve on 127.0.0.1:39001");
    await expect(first).resolves.toBe("http://127.0.0.1:39001");
    await releaseKubeApiProxy("cluster-a");
    expect(spawned[0]?.kill).toHaveBeenCalledTimes(1);

    const second = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(spawned).toHaveLength(2));
    spawned[1]?.handlers.onStdoutLine?.("Starting to serve on 127.0.0.1:39002");
    await expect(second).resolves.toBe("http://127.0.0.1:39002");

    // The first proxy's exit arrives only now, after the second one took its place.
    spawned[0]?.handlers.onClose?.();

    expect(getActiveKubeApiProxyCount()).toBe(1);
    await expect(acquireKubeApiProxy("cluster-a")).resolves.toBe("http://127.0.0.1:39002");
    expect(spawnCliMock).toHaveBeenCalledTimes(2);

    await releaseKubeApiProxy("cluster-a");
    await releaseKubeApiProxy("cluster-a");
    expect(spawned[1]?.kill).toHaveBeenCalledTimes(1);
    expect(getActiveKubeApiProxyCount()).toBe(0);
  });

  it("stops a proxy whose start failed after the process was spawned", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    let stderrHandler: ((line: string) => void) | undefined;
    spawnCliMock.mockImplementation(async (_tool, _args, handlers) => {
      stderrHandler = handlers?.onStderrLine;
      return { command: {} as never, child: { kill } as never };
    });

    const { acquireKubeApiProxy, getActiveKubeApiProxyCount } = await import("./kube-api-proxy");

    const pending = acquireKubeApiProxy("cluster-a");
    await vi.waitFor(() => expect(stderrHandler).toBeDefined());
    stderrHandler?.("error: You must be logged in to the server");

    await expect(pending).rejects.toThrow("You must be logged in to the server");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(getActiveKubeApiProxyCount()).toBe(0);
  });
});
