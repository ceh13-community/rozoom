import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_DEBUG_IMAGE,
  buildNetworkDebugContainerName,
  buildNetworkDebugStartArgs,
  buildNetworkDebugStopArgs,
  readEphemeralContainerState,
  startPodNetworkDebugSession,
} from "./pod-network-debug";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
const openPodNetworkDebugShellModal = vi.hoisted(() => vi.fn());

vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront }));
vi.mock("$features/shell", () => ({ openPodNetworkDebugShellModal }));

const podJson = (state: Record<string, unknown>, name = "rozoom-netshoot-abc123") =>
  JSON.stringify({ status: { ephemeralContainerStatuses: [{ name, state }] } });

const pod = { metadata: { name: "web-a", namespace: "shop" } } as never;

describe("pod network debug", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
    openPodNetworkDebugShellModal.mockReset();
  });

  it("adds a pinned netshoot container to the pod itself, without --target or --copy-to", () => {
    expect(NETWORK_DEBUG_IMAGE).toMatch(/^nicolaka\/netshoot:v\d+\.\d+@sha256:[0-9a-f]{64}$/);
    const args = buildNetworkDebugStartArgs("web-a", "shop", "rozoom-netshoot-abc123");
    expect(args.slice(0, 6)).toEqual([
      "debug",
      "pod/web-a",
      "-n",
      "shop",
      `--image=${NETWORK_DEBUG_IMAGE}`,
      "--container=rozoom-netshoot-abc123",
    ]);
    expect(args.some((arg) => arg.startsWith("--target") || arg.startsWith("--copy-to"))).toBe(
      false,
    );
    // The bundled kubectl defaults to --profile=general, which adds SYS_PTRACE.
    expect(args.filter((arg) => arg.startsWith("--profile"))).toEqual(["--profile=netadmin"]);
    expect(args.at(-1)).toMatch(/^sleep 3600 & echo \$! > \/tmp\/\S+; wait$/);
    expect(buildNetworkDebugContainerName()).toMatch(/^rozoom-netshoot-[a-z0-9]{1,6}$/);
  });

  it("stops only its own sleep, in its own container", () => {
    expect(buildNetworkDebugStopArgs("web-a", "shop", "rozoom-netshoot-abc123")).toEqual([
      "exec",
      "-i",
      "--namespace",
      "shop",
      "-c",
      "rozoom-netshoot-abc123",
      "web-a",
      "--",
      "sh",
      "-c",
      'kill "$(cat /tmp/rozoom-debug-session.pid)"',
    ]);
  });

  it("reads the ephemeral container state", () => {
    const c = "rozoom-netshoot-abc123";
    expect(readEphemeralContainerState(podJson({ running: {} }), c)).toEqual({ kind: "running" });
    expect(
      readEphemeralContainerState(podJson({ waiting: { reason: "ContainerCreating" } }), c),
    ).toEqual({ kind: "pending" });
    expect(readEphemeralContainerState(podJson({ running: {} }, "other"), c)).toEqual({
      kind: "pending",
    });
    expect(readEphemeralContainerState("not json", c)).toEqual({ kind: "pending" });
    expect(
      readEphemeralContainerState(
        podJson({ waiting: { reason: "ImagePullBackOff", message: "Back-off pulling image" } }),
        c,
      ),
    ).toEqual({ kind: "failed", reason: "ImagePullBackOff: Back-off pulling image" });
    expect(
      readEphemeralContainerState(podJson({ terminated: { reason: "Error", message: "" } }), c),
    ).toEqual({ kind: "failed", reason: "Error" });
  });

  it("opens a shell in the container once it runs, with the command that stops it", async () => {
    kubectlRawArgsFront.mockImplementation(async (args: string[]) => {
      if (args[0] === "debug") return { output: "", errors: "", code: 0 };
      const container = (kubectlRawArgsFront.mock.calls[0][0] as string[])[5].split("=")[1];
      return { output: podJson({ running: {} }, container), errors: "", code: 0 };
    });

    const { container } = await startPodNetworkDebugSession({ clusterId: "c1", pod });

    expect(kubectlRawArgsFront).toHaveBeenNthCalledWith(
      2,
      ["get", "pod", "web-a", "-n", "shop", "-o", "json"],
      { clusterId: "c1" },
    );
    expect(openPodNetworkDebugShellModal).toHaveBeenCalledWith("c1", pod, {
      container,
      stopArgs: buildNetworkDebugStopArgs("web-a", "shop", container),
      sessionLabel: "web-a (network debug)",
    });
  });

  it("reports an image that cannot be pulled instead of waiting it out", async () => {
    kubectlRawArgsFront.mockImplementation(async (args: string[]) => {
      if (args[0] === "debug") return { output: "", errors: "", code: 0 };
      const container = (kubectlRawArgsFront.mock.calls[0][0] as string[])[5].split("=")[1];
      return {
        output: podJson({ waiting: { reason: "ErrImagePull", message: "no route" } }, container),
        errors: "",
        code: 0,
      };
    });

    await expect(startPodNetworkDebugSession({ clusterId: "c1", pod })).rejects.toThrow(
      "Network debug container did not start (ErrImagePull: no route).",
    );
    expect(openPodNetworkDebugShellModal).not.toHaveBeenCalled();
  });

  it("passes on a refused start, such as a read-only cluster or missing rights", async () => {
    kubectlRawArgsFront.mockResolvedValue({
      output: "",
      errors: "[BLOCKED] This cluster is read-only.",
      code: 1,
    });

    await expect(startPodNetworkDebugSession({ clusterId: "c1", pod })).rejects.toThrow(
      "[BLOCKED] This cluster is read-only.",
    );
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);
    expect(openPodNetworkDebugShellModal).not.toHaveBeenCalled();
  });

  it("shows what kubectl warned about while starting the container", async () => {
    kubectlRawArgsFront.mockImplementation(async (args: string[]) => {
      if (args[0] === "debug") {
        return { output: "", errors: "", code: 0, warnings: "Warning: would violate PodSecurity" };
      }
      const container = (kubectlRawArgsFront.mock.calls[0][0] as string[])[5].split("=")[1];
      return { output: podJson({ running: {} }, container), errors: "", code: 0 };
    });

    const result = await startPodNetworkDebugSession({ clusterId: "c1", pod });

    expect(result.warnings).toBe("Warning: would violate PodSecurity");
    expect(openPodNetworkDebugShellModal).toHaveBeenCalledWith(
      "c1",
      pod,
      expect.objectContaining({ notice: "kubectl warning: Warning: would violate PodSecurity" }),
    );
  });
});
