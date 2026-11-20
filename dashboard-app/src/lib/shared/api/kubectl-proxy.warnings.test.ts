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

// kubectl prints deprecations and admission warnings to stderr and still exits 0. They were
// dropped, because stderr was kept only as `errors` of a failed run.
describe("kubectlRawArgsFront stderr of a successful run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("returns it as warnings, not as errors", async () => {
    sidecarMock.mockImplementation(() => sidecar("", "Warning: would violate PodSecurity\n", 0));

    const result = await kubectlRawArgsFront(["debug", "pod/web", "--image=x"]);

    expect(result).toEqual({
      output: "",
      errors: "",
      code: 0,
      warnings: "Warning: would violate PodSecurity",
    });
  });

  it("keeps a failed run as errors without warnings", async () => {
    sidecarMock.mockImplementation(() => sidecar("", "Error from server (Forbidden)", 1));

    const result = await kubectlRawArgsFront(["debug", "pod/web", "--image=x"]);

    expect(result.errors).toContain("Error from server (Forbidden)");
    expect(result.warnings).toBeUndefined();
  });

  it("adds no warnings field when stderr is empty", async () => {
    sidecarMock.mockImplementation(() => sidecar("ok", "", 0));

    expect(await kubectlRawArgsFront(["get", "ns"])).toEqual({ output: "ok", errors: "", code: 0 });
  });
});
