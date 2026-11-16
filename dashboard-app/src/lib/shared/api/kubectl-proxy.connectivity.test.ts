import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// setupTests.ts automocks kubectl-proxy for the whole suite; this test needs the
// real module, which reports every finished exec to the connectivity state.
vi.unmock("@/lib/shared/api/kubectl-proxy");

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

import { kubectlRawArgsFront } from "./kubectl-proxy";
import {
  reportKubectlOutcome,
  resetClusterConnectivity,
  selectClusterConnectivity,
} from "$shared/model/cluster-connectivity";

type Listener = (payload?: unknown) => void;

const REFUSED =
  "The connection to the server 127.0.0.1:6443 was refused - did you specify the right host or port?";

/** A sidecar that ends only when the test calls finish(). */
function createSidecar() {
  const listeners = new Map<string, Listener[]>();
  const stderrListeners: Array<(chunk: string) => void> = [];
  const spawned = { value: false };
  const command = {
    on(event: string, handler: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    stdout: { on() {} },
    stderr: {
      on(_event: string, handler: (chunk: string) => void) {
        stderrListeners.push(handler);
      },
    },
    spawn: vi.fn(() => {
      spawned.value = true;
      return Promise.resolve({ kill: vi.fn().mockResolvedValue(undefined) });
    }),
  };
  return {
    command,
    spawned,
    finish(close: { code: number | null; signal?: number | null }, stderr = "") {
      for (const handler of stderrListeners) handler(stderr);
      for (const handler of listeners.get("close") ?? []) handler(close);
    },
  };
}

async function waitForSpawn(sidecar: ReturnType<typeof createSidecar>) {
  await vi.waitFor(() => {
    expect(sidecar.spawned.value).toBe(true);
  });
}

describe("kubectl proxy feeding the cluster connectivity state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetClusterConnectivity();
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it("records no verdict for a kubectl ended by a signal", async () => {
    const sidecar = createSidecar();
    sidecarMock.mockReturnValue(sidecar.command);
    const call = kubectlRawArgsFront(["get", "pods", "-A"], { clusterId: "dev" });
    await waitForSpawn(sidecar);
    sidecar.finish({ code: null, signal: 9 });
    await call;
    expect(get(selectClusterConnectivity("dev")).state).toBe("unknown");
  });

  it("drops the failure of a call that was spawned before a newer answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const sidecar = createSidecar();
    sidecarMock.mockReturnValue(sidecar.command);
    const slowList = kubectlRawArgsFront(["get", "pods", "-A"], { clusterId: "dev" });
    await waitForSpawn(sidecar);

    // A Retry started later and the cluster answered it.
    vi.setSystemTime(5_000);
    reportKubectlOutcome("dev", { code: 0, stderr: "" }, { startedAt: 5_000 });

    // The list started at 1000 fails only now.
    vi.setSystemTime(10_000);
    sidecar.finish({ code: 1 }, REFUSED);
    await slowList;
    expect(get(selectClusterConnectivity("dev")).state).toBe("online");
  });

  it("records a failure of a call spawned after the last answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    reportKubectlOutcome("dev", { code: 0, stderr: "" }, { startedAt: 1_000 });
    vi.setSystemTime(2_000);
    const sidecar = createSidecar();
    sidecarMock.mockReturnValue(sidecar.command);
    const call = kubectlRawArgsFront(["get", "pods", "-A"], { clusterId: "dev" });
    await waitForSpawn(sidecar);
    vi.setSystemTime(3_000);
    sidecar.finish({ code: 1 }, REFUSED);
    await call;
    expect(get(selectClusterConnectivity("dev"))).toMatchObject({
      state: "unreachable",
      reason: "Connection refused",
    });
  });
});
