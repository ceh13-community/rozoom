import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// setupTests.ts automocks kubectl-proxy for the whole suite; this test needs
// the real module so the argv that reaches the sidecar is the one under test.
vi.unmock("@/lib/shared/api/kubectl-proxy");

// vi.mock factories are hoisted above every const, so the mock must be too.
const { sidecarMock } = vi.hoisted(() => ({ sidecarMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    sidecar: sidecarMock,
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/tmp/appdata"),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

import { kubectlJson } from "./kubectl-proxy";

type Listener = (payload?: unknown) => void;

function createSidecarHarness(stdout: string) {
  const listeners = new Map<string, Listener[]>();
  const stdoutListeners: Array<(chunk: string) => void> = [];
  const child = { kill: vi.fn().mockResolvedValue(undefined) };
  const command = {
    on(event: string, handler: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    stdout: {
      on(_event: string, handler: (chunk: string) => void) {
        stdoutListeners.push(handler);
      },
    },
    stderr: {
      on() {},
    },
    spawn: vi.fn(async () => {
      queueMicrotask(() => {
        for (const handler of stdoutListeners) handler(stdout);
        for (const handler of listeners.get("close") ?? []) handler({ code: 0 });
      });
      return child;
    }),
  };
  return command;
}

describe("kubectlJson argv handed to the kubectl sidecar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // canUseDesktopKubectlRuntime() needs the Tauri marker on window.
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    sidecarMock.mockImplementation(() => createSidecarHarness('{"items":[]}'));
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("sends a --raw request without any -o flag", async () => {
    const result = await kubectlJson("get --raw=/x --request-timeout=15s");

    expect(result).toEqual({ items: [] });
    expect(sidecarMock).toHaveBeenCalledTimes(1);
    expect(sidecarMock).toHaveBeenCalledWith("binaries/rozoom-kubectl", [
      "get",
      "--raw=/x",
      "--request-timeout=15s",
    ]);
  });

  it("appends -o json to a plain read before the default request timeout", async () => {
    const result = await kubectlJson("get pods");

    expect(result).toEqual({ items: [] });
    expect(sidecarMock).toHaveBeenCalledTimes(1);
    expect(sidecarMock).toHaveBeenCalledWith("binaries/rozoom-kubectl", [
      "get",
      "pods",
      "-o",
      "json",
      "--request-timeout=10s",
    ]);
  });
});
