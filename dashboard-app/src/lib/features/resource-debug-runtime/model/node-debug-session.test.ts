import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
const openPodDebugShellModal = vi.hoisted(() => vi.fn());
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront }));
vi.mock("$features/shell", () => ({ openPodDebugShellModal }));

import {
  buildNodeDebugArgs,
  describeNodeDebugFailure,
  parseNodeDebugPodName,
  startNodeDebugSession,
} from "./node-debug-session";

const CREATED =
  "Creating debugging pod node-debugger-minikube-x7k2q with container debugger on node minikube.";

describe("node debug session", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
    openPodDebugShellModal.mockReset();
  });

  it("asks kubectl for a node debug pod that stays up for the shell", () => {
    expect(buildNodeDebugArgs({ clusterId: "c1", nodeName: "minikube" })).toEqual([
      "debug",
      "node/minikube",
      "-n",
      "default",
      "--profile=general",
      "--image=busybox:1.36",
      "--",
      "sleep",
      "86400",
    ]);
  });

  it("reads the pod name kubectl chose", () => {
    expect(parseNodeDebugPodName(CREATED)).toBe("node-debugger-minikube-x7k2q");
    expect(parseNodeDebugPodName('error: nodes "x" not found')).toBeNull();
  });

  it("opens a shell on the debug pod and deletes the pod when the window closes", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce({
        output: "pod/node-debugger-minikube-x7k2q condition met",
        errors: "",
        code: 0,
      });
    await startNodeDebugSession({ clusterId: "c1", nodeName: "minikube" });
    expect(openPodDebugShellModal).toHaveBeenCalledWith(
      "c1",
      { metadata: { name: "node-debugger-minikube-x7k2q", namespace: "default" } },
      expect.objectContaining({
        cleanupPod: { name: "node-debugger-minikube-x7k2q", namespace: "default" },
        sessionLabel: "Node shell minikube",
      }),
    );
    expect(openPodDebugShellModal.mock.calls[0][2].notice).toContain("/host");
  });

  it("explains an image pull failure and removes the pod", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce({ output: "", errors: "timed out waiting for the condition", code: 1 })
      .mockResolvedValueOnce({ output: "ImagePullBackOff", errors: "", code: 0 })
      .mockResolvedValueOnce({ output: "", errors: "", code: 0 });
    await expect(startNodeDebugSession({ clusterId: "c1", nodeName: "minikube" })).rejects.toThrow(
      "the node could not pull busybox:1.36 (ImagePullBackOff)",
    );
    const deleteCall = kubectlRawArgsFront.mock.calls[3][0] as string[];
    expect(deleteCall.slice(0, 3)).toEqual(["delete", "pod", "node-debugger-minikube-x7k2q"]);
    expect(openPodDebugShellModal).not.toHaveBeenCalled();
  });

  it("falls back to kubectl's own error for other failures", () => {
    expect(describeNodeDebugFailure("", "busybox:1.36", "forbidden")).toBe("forbidden");
    expect(describeNodeDebugFailure("CreateContainerError", "busybox:1.36", "x")).toBe(
      "Node shell did not start: CreateContainerError.",
    );
  });

  it("moves to kube-system when Pod Security refuses the pod in default", async () => {
    const refused =
      'Error from server (Forbidden): pods "node-debugger-minikube-a" is forbidden: violates PodSecurity "baseline:latest": host namespaces';
    kubectlRawArgsFront
      .mockResolvedValueOnce({
        output: "Creating debugging pod node-debugger-minikube-a",
        errors: refused,
        code: 1,
      })
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce({ output: "condition met", errors: "", code: 0 });
    await startNodeDebugSession({ clusterId: "c1", nodeName: "minikube" });
    expect((kubectlRawArgsFront.mock.calls[1][0] as string[]).slice(2, 4)).toEqual([
      "-n",
      "kube-system",
    ]);
    expect(openPodDebugShellModal.mock.calls[0][2].cleanupPod).toEqual({
      name: "node-debugger-minikube-x7k2q",
      namespace: "kube-system",
    });
  });

  it("says Pod Security is the cause when every namespace refuses", async () => {
    const refused = 'pods "x" is forbidden: violates PodSecurity "baseline:latest"';
    kubectlRawArgsFront.mockResolvedValue({ output: "", errors: refused, code: 1 });
    await expect(startNodeDebugSession({ clusterId: "c1", nodeName: "minikube" })).rejects.toThrow(
      "Pod Security in default and kube-system forbids the host namespaces",
    );
    expect(openPodDebugShellModal).not.toHaveBeenCalled();
  });
});
