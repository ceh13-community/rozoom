import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPodDebugCleanupArgs,
  buildPodDebugCopyName,
  buildPodDebugSessionArgs,
  buildPodDebugWaitArgs,
  startPodDebugSession,
} from "./pod-debug-session";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
const openPodDebugShellModal = vi.hoisted(() => vi.fn());

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront,
}));

vi.mock("$features/shell", () => ({
  openPodDebugShellModal,
}));

describe("pod debug session runtime", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
    openPodDebugShellModal.mockReset();
  });

  it("builds a copy-of-pod debug command", () => {
    expect(
      buildPodDebugSessionArgs(
        {
          clusterId: "cluster-a",
          name: "api-0",
          namespace: "prod",
          container: "api",
        },
        "debug-copy-api-0-abc123",
      ),
    ).toEqual([
      "debug",
      "pod/api-0",
      "-n",
      "prod",
      "--copy-to=debug-copy-api-0-abc123",
      "--share-processes",
      "--image=busybox:1.36",
      "--target=api",
      "--",
      "/bin/sh",
    ]);
  });

  it("builds wait and cleanup args", () => {
    expect(buildPodDebugWaitArgs("debug-copy-api-0-abc123", "prod")).toEqual([
      "wait",
      "--for=condition=Ready",
      "pod/debug-copy-api-0-abc123",
      "-n",
      "prod",
      "--timeout=180s",
    ]);
    expect(buildPodDebugCleanupArgs("debug-copy-api-0-abc123", "prod")).toContain(
      "debug-copy-api-0-abc123",
    );
  });

  it("opens a debug shell against the created copy pod", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: "created", errors: "", code: 0 })
      .mockResolvedValueOnce({ output: "ready", errors: "", code: 0 });

    const result = await startPodDebugSession({
      clusterId: "cluster-a",
      name: "api-0",
      namespace: "prod",
      container: "api",
    });

    expect(result.namespace).toBe("prod");
    expect(result.debugPodName).toMatch(/^debug-copy-api-0-/);
    expect(openPodDebugShellModal).toHaveBeenCalledWith(
      "cluster-a",
      {
        metadata: {
          name: result.debugPodName,
          namespace: "prod",
        },
      },
      {
        cleanupPod: {
          name: result.debugPodName,
          namespace: "prod",
        },
        sessionLabel: "Debug session prod/api-0",
      },
    );
  });

  it("builds deterministic copy names when random is stubbed", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    expect(buildPodDebugCopyName({ name: "API_0" })).toBe("debug-copy-api-0-4fzzzx");
  });
});
