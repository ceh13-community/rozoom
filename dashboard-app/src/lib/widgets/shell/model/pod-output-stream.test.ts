import { beforeEach, describe, expect, it, vi } from "vitest";

const cli = vi.hoisted(() => ({
  spawnCli: vi.fn(),
  resolveKubeconfigPath: vi.fn(async (id: string) => `/data/configs/${id}.yaml`),
}));
vi.mock("$shared/api/cli", () => cli);

import { startPodOutputStream } from "./pod-output-stream";

type Handlers = {
  onStdoutLine: (line: string) => void;
  onStderrLine: (line: string) => void;
  onClose: (event: unknown) => void;
};

const pod = (tty?: boolean) =>
  ({
    metadata: { name: "web", namespace: "shop" },
    spec: { containers: [{ name: "app", tty }] },
  }) as never;

describe("pod output stream", () => {
  let handlers: Handlers;
  const kill = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    cli.spawnCli.mockImplementation(async (_tool: string, _args: string[], h: Handlers) => {
      handlers = h;
      return { command: {}, child: { kill } };
    });
  });

  it("attaches read-only to a container without a tty and drops the interactive banner", async () => {
    const lines: string[] = [];
    const onEnd = vi.fn();
    const stream = await startPodOutputStream({
      clusterId: "c1",
      pod: pod(),
      onLine: (line) => lines.push(line),
      onEnd,
    });

    expect(stream.viaLog).toBe(false);
    expect(cli.spawnCli).toHaveBeenCalledWith(
      "kubectl",
      [
        "attach",
        "--namespace",
        "shop",
        "-c",
        "app",
        "web",
        "--kubeconfig",
        "/data/configs/c1.yaml",
      ],
      expect.any(Object),
    );
    handlers.onStderrLine("If you don't see a command prompt, try pressing enter.\n");
    handlers.onStdoutLine("10.0.0.1 - - GET / 200\n");
    handlers.onClose({ code: 0 });
    handlers.onClose({ code: 0 });

    expect(lines).toEqual(["10.0.0.1 - - GET / 200"]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith(0);
  });

  it("follows the log of a tty container, which kubectl cannot attach without a terminal", async () => {
    const stream = await startPodOutputStream({
      clusterId: "c1",
      pod: pod(true),
      onLine: vi.fn(),
      onEnd: vi.fn(),
    });

    expect(stream.viaLog).toBe(true);
    expect(cli.spawnCli.mock.calls[0][1]).toEqual([
      "logs",
      "--follow",
      "--tail=0",
      "--namespace",
      "shop",
      "-c",
      "app",
      "web",
      "--kubeconfig",
      "/data/configs/c1.yaml",
    ]);
  });

  it("kills kubectl on stop and does not report that as the stream ending", async () => {
    const onEnd = vi.fn();
    const stream = await startPodOutputStream({
      clusterId: "c1",
      pod: pod(),
      onLine: vi.fn(),
      onEnd,
    });

    await stream.stop();
    handlers.onClose({ code: 143 });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
