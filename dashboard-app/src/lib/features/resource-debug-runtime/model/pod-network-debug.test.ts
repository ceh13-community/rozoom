import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_DEBUG_CUSTOM_SPEC,
  NETWORK_DEBUG_IMAGE,
  buildNetworkDebugContainerName,
  buildNetworkDebugStartArgs,
  buildNetworkDebugStopArgs,
  describeNetworkDebugRefusal,
  NetworkDebugRefusal,
  readEphemeralContainerState,
  startPodNetworkDebugSession,
} from "./pod-network-debug";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
const openPodNetworkDebugShellModal = vi.hoisted(() => vi.fn());
const fs = vi.hoisted(() => ({
  writeTextFile: vi.fn(async (_path: string, _content: string) => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront }));
vi.mock("$features/shell", () => ({ openPodNetworkDebugShellModal }));
vi.mock("@tauri-apps/plugin-fs", () => fs);
const tauriPath = vi.hoisted(() => ({
  appDataDir: vi.fn(async () => "/app-data"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));
vi.mock("@tauri-apps/api/path", () => tauriPath);

const podJson = (state: Record<string, unknown>, name = "rozoom-netshoot-abc123") =>
  JSON.stringify({ status: { ephemeralContainerStatuses: [{ name, state }] } });

const pod = { metadata: { name: "web-a", namespace: "shop" } } as never;

describe("pod network debug", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
    openPodNetworkDebugShellModal.mockReset();
    fs.writeTextFile.mockClear();
    fs.remove.mockClear();
  });

  it("adds a pinned netshoot container to the pod itself, without --target or --copy-to", () => {
    expect(NETWORK_DEBUG_IMAGE).toMatch(/^nicolaka\/netshoot:v\d+\.\d+@sha256:[0-9a-f]{64}$/);
    const args = buildNetworkDebugStartArgs(
      "web-a",
      "shop",
      "rozoom-netshoot-abc123",
      "/app-data/spec.json",
    );
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
    expect(args.filter((arg) => arg.startsWith("--profile"))).toEqual(["--profile=baseline"]);
    expect(args.filter((arg) => arg.startsWith("--custom"))).toEqual([
      "--custom=/app-data/spec.json",
    ]);
    expect(args.at(-1)).toMatch(/^sleep 3600 & echo \$! > \/tmp\/\S+; wait$/);
    expect(buildNetworkDebugContainerName()).toMatch(/^rozoom-netshoot-[a-z0-9]{1,6}$/);
  });

  it("asks for NET_RAW and nothing else", () => {
    expect(NETWORK_DEBUG_CUSTOM_SPEC).toEqual({
      securityContext: { capabilities: { add: ["NET_RAW"] } },
    });
  });

  it("writes the NET_RAW spec for kubectl and removes it after the start", async () => {
    kubectlRawArgsFront.mockImplementation(async (args: string[]) => {
      if (args[0] === "debug") return { output: "", errors: "", code: 0 };
      const container = (kubectlRawArgsFront.mock.calls[0][0] as string[])[5].split("=")[1];
      return { output: podJson({ running: {} }, container), errors: "", code: 0 };
    });

    await startPodNetworkDebugSession({ clusterId: "c1", pod });

    const [path, content] = fs.writeTextFile.mock.calls[0] as unknown as [string, string];
    expect(path).toMatch(/^\/app-data\/network-debug-[a-z0-9]+\.json$/);
    expect(JSON.parse(content)).toEqual(NETWORK_DEBUG_CUSTOM_SPEC);
    expect(kubectlRawArgsFront.mock.calls[0][0]).toContain(`--custom=${path}`);
    expect(fs.remove).toHaveBeenCalledWith(path);
  });

  it("says a Pod Security refusal needs the privileged level and keeps kubectl's line", async () => {
    const stderr =
      'Error from server (Forbidden): pods "web-a" is forbidden: violates PodSecurity "baseline:latest": non-default capabilities (container "rozoom-netshoot-abc123" must not include "NET_RAW" in securityContext.capabilities.add)';
    kubectlRawArgsFront.mockResolvedValue({ output: "", errors: stderr, code: 1 });

    const refusal = await startPodNetworkDebugSession({ clusterId: "c1", pod }).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(NetworkDebugRefusal);
    expect((refusal as NetworkDebugRefusal).message).toBe(
      'Namespace shop does not allow network debug: its Pod Security level is "baseline", and network debug needs the "privileged" level for the NET_RAW capability that tcpdump, ping and mtr use.',
    );
    expect((refusal as NetworkDebugRefusal).detail).toBe(stderr);
    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(openPodNetworkDebugShellModal).not.toHaveBeenCalled();
  });

  it("names the restricted level the same way", () => {
    const refusal = describeNetworkDebugRefusal(
      'pods "web-a" is forbidden: violates PodSecurity "restricted:latest": runAsNonRoot != true',
      "shop",
    );
    expect(refusal.message).toContain('Pod Security level is "restricted"');
    expect(refusal.message).toContain('needs the "privileged" level');
  });

  it("passes on other refusals as kubectl wrote them", () => {
    const refusal = describeNetworkDebugRefusal('error: pods "x" not found', "shop");
    expect(refusal.message).toBe('error: pods "x" not found');
    expect(refusal.detail).toBeNull();
  });

  it("removes the spec file also when kubectl itself throws", async () => {
    kubectlRawArgsFront.mockRejectedValue(new Error("spawn failed"));

    await expect(startPodNetworkDebugSession({ clusterId: "c1", pod })).rejects.toThrow(
      "spawn failed",
    );
    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledWith(fs.writeTextFile.mock.calls[0]?.[0]);
  });

  it("builds the spec path with the platform join, not a hard-coded slash", async () => {
    // A join that is not "/" shows whether the path really comes from join.
    tauriPath.join.mockImplementationOnce(async (...parts: string[]) => parts.join("\\"));
    kubectlRawArgsFront.mockResolvedValue({ output: "", errors: "boom", code: 1 });
    await startPodNetworkDebugSession({ clusterId: "c1", pod }).catch(() => undefined);

    expect(tauriPath.join).toHaveBeenCalledWith(
      "/app-data",
      expect.stringMatching(/^network-debug-[a-z0-9]+\.json$/),
    );
    expect(String(fs.writeTextFile.mock.calls[0]?.[0])).toMatch(
      /^\/app-data\\network-debug-[a-z0-9]+\.json$/,
    );
  });

  it("shows only kubectl's last line, never a credential plugin's output before it", async () => {
    const stderr = [
      "[ERROR] [2026-11-20T11:23:28.292Z]: Please visit https://login.example.com/device and enter code ABCD-EFGH",
      'Error from server (Forbidden): pods "web-a" is forbidden: violates PodSecurity "baseline:latest": non-default capabilities',
    ].join("\n");
    kubectlRawArgsFront.mockResolvedValue({ output: "", errors: stderr, code: 1 });

    const refusal = (await startPodNetworkDebugSession({ clusterId: "c1", pod }).catch(
      (error: unknown) => error,
    )) as NetworkDebugRefusal;

    expect(refusal.detail).toBe(
      'Error from server (Forbidden): pods "web-a" is forbidden: violates PodSecurity "baseline:latest": non-default capabilities',
    );
    expect(`${refusal.message} ${refusal.detail}`).not.toMatch(/ABCD-EFGH|login\.example/);

    const other = describeNetworkDebugRefusal(
      'Enter code WXYZ-1234 at https://login.example.com\nerror: pods "x" not found',
      "shop",
    );
    expect(other.message).toBe('error: pods "x" not found');
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
