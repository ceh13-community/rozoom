import { beforeEach, describe, expect, it, vi } from "vitest";

const appDataDirMock = vi.fn().mockResolvedValue("/tmp/appdata");
const dispatchClusterEventMock = vi.fn();
const parser = vi.fn();
const sidecarMock = vi.fn();

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: appDataDirMock,
}));

vi.mock("./watcher-parser", () => ({
  dispatchClusterEvent: dispatchClusterEventMock,
}));

function createCommandHarness() {
  const listeners = new Map<string, Array<(payload?: unknown) => void>>();
  const stdoutListeners = new Map<string, Array<(payload: string) => void>>();
  const stderrListeners = new Map<string, Array<(payload: string) => void>>();
  const child = {
    kill: vi.fn().mockResolvedValue(undefined),
  };
  const command = {
    on(event: string, handler: (payload?: unknown) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    stdout: {
      on(event: string, handler: (payload: string) => void) {
        const list = stdoutListeners.get(event) ?? [];
        list.push(handler);
        stdoutListeners.set(event, list);
      },
    },
    stderr: {
      on(event: string, handler: (payload: string) => void) {
        const list = stderrListeners.get(event) ?? [];
        list.push(handler);
        stderrListeners.set(event, list);
      },
    },
    spawn: vi.fn().mockResolvedValue(child),
  };

  return {
    command,
    child,
    emitClose() {
      for (const handler of listeners.get("close") ?? []) handler();
    },
    emitStdout(line: string) {
      for (const handler of stdoutListeners.get("data") ?? []) handler(line);
    },
  };
}

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    sidecar: sidecarMock,
  },
}));

describe("KubectlWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    appDataDirMock.mockResolvedValue("/tmp/appdata");
    dispatchClusterEventMock.mockReturnValue(null);
  });

  it("stops restarting after repeated empty exits", async () => {
    const harnesses = Array.from({ length: 7 }, () => createCommandHarness());
    const queue = [...harnesses];
    sidecarMock.mockImplementation(() => queue.shift()?.command);

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();
    const onError = vi.fn();

    await watcher.start("get pods -o json", "cluster-a", onError, parser);

    for (let index = 0; index < 6; index += 1) {
      harnesses[index]?.emitClose();
      await vi.advanceTimersByTimeAsync(8_000);
    }

    expect(sidecarMock).toHaveBeenCalledTimes(7);

    harnesses[6]?.emitClose();
    await vi.advanceTimersByTimeAsync(8_000);

    expect(sidecarMock).toHaveBeenCalledTimes(7);
    expect(onError).toHaveBeenCalledWith(
      "watch stream exited 6 times without a successful event; stopping restarts",
    );
  });

  it("resets restart attempts after a valid watch event", async () => {
    const first = createCommandHarness();
    const second = createCommandHarness();
    const third = createCommandHarness();
    sidecarMock
      .mockReturnValueOnce(first.command)
      .mockReturnValueOnce(second.command)
      .mockReturnValueOnce(third.command);
    dispatchClusterEventMock.mockReturnValue({ type: "ADDED" });

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();

    await watcher.start("get pods -o json", "cluster-a", vi.fn(), parser);

    first.emitClose();
    await vi.advanceTimersByTimeAsync(1_000);
    second.emitStdout('{"type":"ADDED"}');
    second.emitClose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sidecarMock).toHaveBeenCalledTimes(3);
  });

  it("parses stdout with the parser of its own stream", async () => {
    const harness = createCommandHarness();
    sidecarMock.mockReturnValueOnce(harness.command);

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();
    await watcher.start("get services -A -o json", "cluster-a", vi.fn(), parser);

    harness.emitStdout('{"type":"ADDED"}');

    expect(dispatchClusterEventMock).toHaveBeenCalledWith("cluster-a", '{"type":"ADDED"}', parser);
  });

  it("does not count a long healthy run as an empty exit", async () => {
    const harnesses = Array.from({ length: 9 }, () => createCommandHarness());
    const queue = [...harnesses];
    sidecarMock.mockImplementation(() => queue.shift()?.command);

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();
    const onError = vi.fn();

    await watcher.start("get services -A -o json", "cluster-a", onError, parser);

    // A quiet list: kubectl ends each watch on --request-timeout with no events.
    for (let index = 0; index < 8; index += 1) {
      await vi.advanceTimersByTimeAsync(300_000);
      harnesses[index]?.emitClose();
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(sidecarMock).toHaveBeenCalledTimes(9);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports giving up to the lifecycle hooks", async () => {
    const harnesses = Array.from({ length: 7 }, () => createCommandHarness());
    const queue = [...harnesses];
    sidecarMock.mockImplementation(() => queue.shift()?.command);

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();
    const onGiveUp = vi.fn();

    await watcher.start("get secrets -A -o json", "cluster-a", vi.fn(), parser, { onGiveUp });
    for (let index = 0; index < 7; index += 1) {
      harnesses[index]?.emitClose();
      await vi.advanceTimersByTimeAsync(8_000);
    }

    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp.mock.calls[0]?.[0]).toContain("stopping restarts");
  });

  it("lists after each watch start and replays the events that arrived meanwhile", async () => {
    const watch = createCommandHarness();
    const list = {
      execute: vi.fn().mockResolvedValue({
        code: 0,
        stdout: JSON.stringify({ items: [{ metadata: { name: "a" } }] }),
        stderr: "",
      }),
    };
    sidecarMock.mockReturnValueOnce(watch.command).mockReturnValueOnce(list);
    dispatchClusterEventMock.mockReturnValue({ kind: "deployment", event: {} });
    const order: string[] = [];
    dispatchClusterEventMock.mockImplementation((_cluster: string, line: string) => {
      order.push(`event ${line}`);
      return { kind: "deployment", event: {} };
    });
    const onRelist = vi.fn((items: unknown[]) => {
      order.push(`relist ${items.length}`);
    });

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();
    await watcher.start(
      "get deployments --all-namespaces -o json --watch-only --output-watch-events --request-timeout=300s",
      "cluster-a",
      vi.fn(),
      parser,
      { onRelist },
    );
    watch.emitStdout("e1");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(onRelist).toHaveBeenCalled();
    });

    expect(sidecarMock.mock.calls[1]?.[1]).toEqual([
      "--kubeconfig",
      "/tmp/appdata/configs/cluster-a.yaml",
      "get",
      "deployments",
      "--all-namespaces",
      "-o",
      "json",
      "--request-timeout=30s",
    ]);
    // The event seen before the list is applied again over it.
    expect(order).toEqual(["event e1", "relist 1", "event e1"]);
  });

  it("does not list when no relist hook is given", async () => {
    const watch = createCommandHarness();
    sidecarMock.mockReturnValueOnce(watch.command);

    const { KubectlWatcher } = await import("./watcher-model");
    const watcher = new KubectlWatcher();
    await watcher.start("get pods -o json", "cluster-a", vi.fn(), parser);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sidecarMock).toHaveBeenCalledTimes(1);
  });
});
