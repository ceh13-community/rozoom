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
});
