import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// setupTests.ts automocks kubectl-proxy for the whole suite; this test needs the real module.
vi.unmock("@/lib/shared/api/kubectl-proxy");

const { sidecarMock } = vi.hoisted(() => ({ sidecarMock: vi.fn() }));

vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { sidecar: sidecarMock } }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: vi.fn().mockResolvedValue("/tmp/appdata") }));
vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));
vi.mock("$shared/analytics/wau-c", () => ({
  trackCoreAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$shared/lib/cli-notification", () => ({
  emitCliNotification: vi.fn(),
  isUserFacingCommand: () => false,
}));
vi.mock("$shared/lib/readonly-guard", () => ({
  checkKubectlReadOnly: () => ({ blocked: false }),
  buildReadOnlyBlockedResult: vi.fn(),
}));

import { kubectlRawArgsFront } from "./kubectl-proxy";

type Listener = (payload?: unknown) => void;

// A sidecar whose stdout arrives in the given chunks: strings (line mode, as the test fakes of
// the other suites send), Uint8Arrays or plain number arrays (raw mode after the IPC JSON).
function sidecar(stdoutChunks: unknown[], code = 0) {
  const listeners = new Map<string, Listener[]>();
  const out: Array<(chunk: unknown) => void> = [];
  return {
    on(event: string, handler: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    stdout: { on: (_event: string, handler: (chunk: unknown) => void) => out.push(handler) },
    stderr: { on: () => undefined },
    spawn: vi.fn(async () => {
      queueMicrotask(() => {
        for (const chunk of stdoutChunks) for (const handler of out) handler(chunk);
        for (const handler of listeners.get("close") ?? []) handler({ code });
      });
      return { kill: vi.fn().mockResolvedValue(undefined) };
    }),
  };
}

// kubectl prints JSON one token per line and the shell plugin sends one IPC message per line:
// the pod list of a 2,000-pod cluster came as over a million messages. One-shot commands now
// ask for raw chunks; watches keep line mode because their parsers read one event per line.
describe("kubectl one-shot output arrives in raw chunks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("asks the shell plugin for raw output on a get command", async () => {
    sidecarMock.mockImplementation(() => sidecar(["{}"]));
    await kubectlRawArgsFront(["get", "pods", "-A", "-o", "json"], { clusterId: "c1" });
    const [, , options] = sidecarMock.mock.calls[0];
    expect(options).toEqual({ encoding: "raw" });
  });

  it("keeps line mode for a watch command", async () => {
    sidecarMock.mockImplementation(() => sidecar(["{}"]));
    await kubectlRawArgsFront(["get", "pods", "-A", "-w", "-o", "json"], { clusterId: "c1" });
    const [, , options] = sidecarMock.mock.calls[0];
    expect(options).toBeUndefined();
  });

  it("joins byte chunks into one string, even across a split multi-byte character", async () => {
    const bytes = new TextEncoder().encode('{"name":"тест","n":1}\n');
    // Split inside the two-byte "е" of "тест".
    const cut = 11;
    sidecarMock.mockImplementation(() =>
      sidecar([bytes.slice(0, cut), Array.from(bytes.slice(cut))]),
    );

    const result = await kubectlRawArgsFront(["get", "pods", "-o", "json"], { clusterId: "c1" });

    expect(result.output).toBe('{"name":"тест","n":1}\n');
  });

  it("still accepts string chunks", async () => {
    sidecarMock.mockImplementation(() => sidecar(["line 1\n", "line 2\n"]));

    const result = await kubectlRawArgsFront(["get", "pods"], { clusterId: "c1" });

    expect(result.output).toBe("line 1\nline 2\n");
  });
});
