import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// setupTests.ts automocks kubectl-proxy for the whole suite; this test needs the real module.
vi.unmock("@/lib/shared/api/kubectl-proxy");

const { sidecarMock, trackCoreAction, emitCliNotification } = vi.hoisted(() => ({
  sidecarMock: vi.fn(),
  trackCoreAction: vi.fn().mockResolvedValue(undefined),
  emitCliNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { sidecar: sidecarMock } }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn().mockResolvedValue("/tmp/appdata") }));
vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));
vi.mock("$shared/analytics/wau-c", () => ({ trackCoreAction }));
vi.mock("$shared/lib/cli-notification", () => ({
  emitCliNotification,
  isUserFacingCommand: () => true,
}));
vi.mock("$shared/lib/readonly-guard", () => ({
  checkKubectlReadOnly: () => ({ blocked: false }),
  buildReadOnlyBlockedResult: vi.fn(),
}));

import { kubectlRawArgsFront } from "./kubectl-proxy";

type Listener = (payload?: unknown) => void;

function sidecar(stdout: string, stderr: string, code: number) {
  const listeners = new Map<string, Listener[]>();
  const out: Array<(chunk: string) => void> = [];
  const err: Array<(chunk: string) => void> = [];
  return {
    on(event: string, handler: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    stdout: { on: (_event: string, handler: (chunk: string) => void) => out.push(handler) },
    stderr: { on: (_event: string, handler: (chunk: string) => void) => err.push(handler) },
    spawn: vi.fn(async () => {
      queueMicrotask(() => {
        if (stdout) for (const handler of out) handler(stdout);
        if (stderr) for (const handler of err) handler(stderr);
        for (const handler of listeners.get("close") ?? []) handler({ code });
      });
      return { kill: vi.fn().mockResolvedValue(undefined) };
    }),
  };
}

// The app removes node debug pods an earlier run left behind. That is housekeeping, not
// something the user did: it must not count as a user action or show a CLI notification.
describe("kubectlRawArgsFront housekeeping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    sidecarMock.mockImplementation(() => sidecar("pod deleted", "", 0));
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("counts a user's delete and notifies about it", async () => {
    await kubectlRawArgsFront(["delete", "pod", "web", "-n", "shop"], { clusterId: "c1" });
    await vi.waitFor(() => {
      expect(trackCoreAction).toHaveBeenCalledWith("rozoom_resource_action_taken", "c1");
    });
    expect(emitCliNotification).toHaveBeenCalled();
  });

  it("neither counts nor notifies a housekeeping delete", async () => {
    await kubectlRawArgsFront(["delete", "pod", "old", "-n", "kube-system"], {
      clusterId: "c1",
      housekeeping: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trackCoreAction).not.toHaveBeenCalled();
    expect(emitCliNotification).not.toHaveBeenCalled();
  });
});
