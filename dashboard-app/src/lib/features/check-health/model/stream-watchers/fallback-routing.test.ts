import { beforeEach, describe, expect, it, vi } from "vitest";

const sidecarMock = vi.fn();

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/appdata"),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    sidecar: sidecarMock,
  },
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

type StdoutHandler = (line: string) => void;

function createCommandHarness() {
  const stdout: StdoutHandler[] = [];
  return {
    command: {
      on: vi.fn(),
      stdout: {
        on(_event: string, handler: StdoutHandler) {
          stdout.push(handler);
        },
      },
      stderr: { on: vi.fn() },
      spawn: vi.fn().mockResolvedValue({ kill: vi.fn().mockResolvedValue(undefined) }),
    },
    emit(line: string) {
      for (const handler of stdout) handler(line);
    },
  };
}

function watchLine(kind: string, name: string) {
  return JSON.stringify({
    type: "ADDED",
    object: {
      apiVersion: kind === "Deployment" ? "apps/v1" : "v1",
      kind,
      metadata: { name, namespace: "probe", resourceVersion: "42" },
    },
  });
}

describe("fallback kubectl watch routing", () => {
  beforeEach(async () => {
    vi.resetModules();
    sidecarMock.mockReset();
    const { eventBus } = await import("./event-bus");
    eventBus.clear();
  });

  it("delivers each stream's events to its own resource, not to pods", async () => {
    const services = createCommandHarness();
    const deployments = createCommandHarness();
    sidecarMock.mockReturnValueOnce(services.command).mockReturnValueOnce(deployments.command);

    const { eventBus } = await import("./event-bus");
    const { initWatchParsers } = await import("./register-parsers");
    const { startConfigurationWatcher } = await import("./configuration/configuration-watcher");
    const { startDeploymentsWatcher } = await import("./deployments/deployments-watcher");
    const received: Array<{ kind: string; payload: unknown }> = [];
    eventBus.subscribe((event) => {
      received.push({ kind: event.kind, payload: event.payload });
    });

    // The global parser list starts with pods and accepts any watch line.
    initWatchParsers();
    startConfigurationWatcher("cluster-a", "services");
    startDeploymentsWatcher("cluster-a");
    await vi.waitFor(() => expect(sidecarMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(deployments.command.spawn).toHaveBeenCalled());

    services.emit(watchLine("Service", "probe-svc"));
    deployments.emit(watchLine("Deployment", "probe-deploy"));

    expect(received.map((event) => event.kind)).toEqual(["configuration", "deployment"]);
    expect(received[0]?.payload).toMatchObject({ workloadType: "services" });
    expect(received.some((event) => event.kind === "pod")).toBe(false);
  });
});
