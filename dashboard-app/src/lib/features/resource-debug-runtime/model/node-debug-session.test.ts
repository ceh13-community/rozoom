import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());
const openPodDebugShellModal = vi.hoisted(() => vi.fn());
vi.mock("$shared/api/kubectl-proxy", () => ({ kubectlRawArgsFront }));
vi.mock("$features/shell", () => ({ openPodDebugShellModal }));

import {
  DEBUG_OWNER_LABEL,
  DEBUG_SESSION_LABEL,
  NODE_DEBUG_IMAGE,
  NODE_DEBUG_RUN_ID,
  buildNodeDebugArgs,
  cleanupOrphanNodeDebugPods,
  describeNodeDebugFailure,
  getDebugOwnerId,
  markNodeDebugPodCreated,
  parseNodeDebugPodName,
  pickUnnamedNodeDebugPods,
  resetNodeDebugCleanupForTests,
  startNodeDebugSession,
} from "./node-debug-session";

const confirm = vi.fn();
const start = (target = { clusterId: "c1", nodeName: "minikube" }) =>
  startNodeDebugSession(target, { confirm });
const OK = { output: "", errors: "", code: 0 };

const CREATED =
  "Creating debugging pod node-debugger-minikube-x7k2q with container debugger on node minikube.";

describe("node debug session", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
    openPodDebugShellModal.mockReset();
    confirm.mockReset().mockResolvedValue(true);
  });

  it("asks kubectl for a node debug pod that stays up for the shell", () => {
    expect(buildNodeDebugArgs({ clusterId: "c1", nodeName: "minikube" })).toEqual([
      "debug",
      "node/minikube",
      "-n",
      "default",
      "--profile=general",
      `--image=${NODE_DEBUG_IMAGE}`,
      "--",
      "sleep",
      "7200",
    ]);
  });

  it("reads the pod name kubectl chose", () => {
    expect(parseNodeDebugPodName(CREATED)).toBe("node-debugger-minikube-x7k2q");
    expect(parseNodeDebugPodName('error: nodes "x" not found')).toBeNull();
  });

  it("pins the image by digest", () => {
    expect(NODE_DEBUG_IMAGE).toMatch(/^busybox:1\.36\.1@sha256:[0-9a-f]{64}$/);
  });

  it("opens a shell on the debug pod and deletes the pod when the window closes", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({
        output: "pod/node-debugger-minikube-x7k2q condition met",
        errors: "",
        code: 0,
      });
    await expect(start()).resolves.toEqual({
      podName: "node-debugger-minikube-x7k2q",
      namespace: "default",
    });
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

  it("asks first that this is root on the node and where the pod goes", async () => {
    confirm.mockResolvedValueOnce(false);
    await expect(start()).resolves.toBeNull();
    expect(confirm.mock.calls[0][0]).toContain("Open a root shell on node minikube?");
    expect(confirm.mock.calls[0][0]).toContain("run as root on the node");
    expect(confirm.mock.calls[0][0]).toContain("in namespace default");
    expect(kubectlRawArgsFront).not.toHaveBeenCalled();
  });

  it("labels the pod with this installation and run right after it is created", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce(OK);
    await start();
    expect(kubectlRawArgsFront.mock.calls[1][0]).toEqual([
      "label",
      "pod",
      "node-debugger-minikube-x7k2q",
      "-n",
      "default",
      `${DEBUG_OWNER_LABEL}=${getDebugOwnerId()}`,
      `${DEBUG_SESSION_LABEL}=${NODE_DEBUG_RUN_ID}`,
      "--overwrite",
    ]);
  });

  it("removes the pod kubectl created but did not name", async () => {
    const createdAt = new Date().toISOString();
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: "pod created", errors: "", code: 0 })
      .mockResolvedValueOnce({
        output: `node-debugger-minikube-q1w2e\t${createdAt}\nnode-debugger-minikube-old\t2020-01-01T00:00:00Z\nweb-1\t${createdAt}\n`,
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce(OK);
    await expect(start()).rejects.toThrow("kubectl did not name the debug pod");
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(3);
    expect((kubectlRawArgsFront.mock.calls[2][0] as string[]).slice(0, 3)).toEqual([
      "delete",
      "pod",
      "node-debugger-minikube-q1w2e",
    ]);
    expect(openPodDebugShellModal).not.toHaveBeenCalled();
  });

  it("explains an image pull failure and removes the pod", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ output: "", errors: "timed out waiting for the condition", code: 1 })
      .mockResolvedValueOnce({ output: "ImagePullBackOff", errors: "", code: 0 })
      .mockResolvedValueOnce({ output: "", errors: "", code: 0 });
    await expect(start()).rejects.toThrow(
      `the node could not pull ${NODE_DEBUG_IMAGE} (ImagePullBackOff)`,
    );
    const deleteCall = kubectlRawArgsFront.mock.calls[4][0] as string[];
    expect(deleteCall.slice(0, 3)).toEqual(["delete", "pod", "node-debugger-minikube-x7k2q"]);
    expect(openPodDebugShellModal).not.toHaveBeenCalled();
  });

  it("falls back to kubectl's own error for other failures", () => {
    expect(describeNodeDebugFailure("", "busybox:1.36", "forbidden")).toBe("forbidden");
    expect(describeNodeDebugFailure("CreateContainerError", "busybox:1.36", "x")).toBe(
      "Node shell did not start: CreateContainerError.",
    );
  });

  const REFUSED =
    '[ERROR] [2026-11-21T22:00:00Z]: Error from server (Forbidden): pods "node-debugger-minikube-a" is forbidden: violates PodSecurity "baseline:latest": host namespaces (hostNetwork=true, hostPID=true, hostIPC=true)';

  it("asks before moving to kube-system when Pod Security refuses the pod in default", async () => {
    kubectlRawArgsFront
      .mockResolvedValueOnce({
        output: "Creating debugging pod node-debugger-minikube-a",
        errors: REFUSED,
        code: 1,
      })
      .mockResolvedValueOnce({ output: CREATED, errors: "", code: 0 })
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ output: "condition met", errors: "", code: 0 });
    await start();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0]).toContain(
      'Pod Security in default refused the debug pod: violates PodSecurity "baseline:latest": host namespaces',
    );
    expect(confirm.mock.calls[1][0]).toContain("Create it in kube-system instead?");
    expect((kubectlRawArgsFront.mock.calls[1][0] as string[]).slice(2, 4)).toEqual([
      "-n",
      "kube-system",
    ]);
    expect(openPodDebugShellModal.mock.calls[0][2].cleanupPod).toEqual({
      name: "node-debugger-minikube-x7k2q",
      namespace: "kube-system",
    });
  });

  it("does not touch kube-system when the user declines", async () => {
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    kubectlRawArgsFront.mockResolvedValueOnce({ output: "", errors: REFUSED, code: 1 });
    await expect(start()).resolves.toBeNull();
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);
    expect(openPodDebugShellModal).not.toHaveBeenCalled();
  });

  it("says Pod Security is the cause when every namespace refuses", async () => {
    const refused = 'pods "x" is forbidden: violates PodSecurity "baseline:latest"';
    kubectlRawArgsFront.mockResolvedValue({ output: "", errors: refused, code: 1 });
    await expect(start()).rejects.toThrow(
      "Pod Security in default and kube-system forbids the host namespaces",
    );
    expect(openPodDebugShellModal).not.toHaveBeenCalled();
  });
});

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

describe("debug pods left by an earlier run", () => {
  const startedAt = Date.parse("2026-11-21T22:00:00Z");
  const OLD = "2026-11-21T20:00:00Z";
  const NEW = "2026-11-21T22:05:00Z";

  beforeEach(() => {
    kubectlRawArgsFront.mockReset().mockResolvedValue(OK);
    resetNodeDebugCleanupForTests();
  });

  it("runs no kubectl at all where this installation never created a node debug pod", async () => {
    await cleanupOrphanNodeDebugPods("c1", memoryStorage(), startedAt);
    expect(kubectlRawArgsFront).not.toHaveBeenCalled();
  });

  it("deletes only pods older than this process, as housekeeping, once per cluster", async () => {
    const storage = memoryStorage();
    markNodeDebugPodCreated("c1", storage);
    kubectlRawArgsFront.mockImplementation((args: string[]) =>
      Promise.resolve(
        args[0] === "get" && args[3] === "default"
          ? {
              output: `node-debugger-minikube-old\t${OLD}\nnode-debugger-minikube-live\t${NEW}\n`,
              errors: "",
              code: 0,
            }
          : OK,
      ),
    );
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    const calls = kubectlRawArgsFront.mock.calls.map(([args]) => (args as string[]).slice(0, 4));
    expect(calls).toEqual([
      ["get", "pods", "-n", "default"],
      ["delete", "pod", "node-debugger-minikube-old", "--namespace"],
      ["get", "pods", "-n", "kube-system"],
    ]);
    expect(kubectlRawArgsFront.mock.calls[0][0]).toContain(
      `${DEBUG_OWNER_LABEL}=${getDebugOwnerId(storage)}`,
    );
    for (const [, options] of kubectlRawArgsFront.mock.calls) {
      expect(options).toEqual({ clusterId: "c1", housekeeping: true });
    }
    // A newer pod (another copy's open shell) is still there: the cluster stays marked.
    resetNodeDebugCleanupForTests();
    kubectlRawArgsFront.mockClear();
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    expect(kubectlRawArgsFront).toHaveBeenCalled();
  });

  it("forgets the cluster once none of its debug pods is left", async () => {
    const storage = memoryStorage();
    markNodeDebugPodCreated("c1", storage);
    kubectlRawArgsFront.mockImplementation((args: string[]) =>
      Promise.resolve(
        args[0] === "get" && args[3] === "default"
          ? { output: `node-debugger-minikube-old\t${OLD}\n`, errors: "", code: 0 }
          : OK,
      ),
    );
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    resetNodeDebugCleanupForTests();
    kubectlRawArgsFront.mockClear();
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    expect(kubectlRawArgsFront).not.toHaveBeenCalled();
  });

  it("keeps the cluster marked when kubectl is refused", async () => {
    const storage = memoryStorage();
    markNodeDebugPodCreated("c1", storage);
    kubectlRawArgsFront.mockResolvedValue({ output: "", errors: "Forbidden", code: 1 });
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    resetNodeDebugCleanupForTests();
    kubectlRawArgsFront.mockClear();
    await cleanupOrphanNodeDebugPods("c1", storage, startedAt);
    expect(kubectlRawArgsFront).toHaveBeenCalled();
  });

  it("keeps one owner id per installation", () => {
    const storage = memoryStorage();
    const first = getDebugOwnerId(storage);
    expect(first).toMatch(/^[\w-]{8,63}$/);
    expect(getDebugOwnerId(storage)).toBe(first);
  });

  it("picks only this node's debug pods created around the start", () => {
    const since = Date.parse("2026-11-21T22:00:00Z");
    const listing = [
      "node-debugger-minikube-a\t2026-11-21T22:00:03Z",
      "node-debugger-minikube-b\t2026-11-21T20:00:00Z",
      "node-debugger-other-c\t2026-11-21T22:00:03Z",
      "web-1\t2026-11-21T22:00:03Z",
    ].join("\n");
    expect(pickUnnamedNodeDebugPods(listing, "minikube", since)).toEqual([
      "node-debugger-minikube-a",
    ]);
  });
});
