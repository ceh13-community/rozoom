// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { openPodDebugShellModal } from "$features/shell";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { buildPodDebugCleanupArgs, buildPodDebugWaitArgs } from "./pod-debug-session";

/**
 * Node shell the way `kubectl debug node/<name>` gives one: a pod on that node with the
 * host's PID, network and IPC namespaces and its root file system at /host. The pod runs
 * until the shell window closes, which deletes it.
 */
export type NodeDebugSessionTarget = {
  clusterId: string;
  nodeName: string;
  /** Namespace the debugger pod is created in. */
  namespace?: string | null;
  image?: string | null;
};

export const NODE_DEBUG_IMAGE = "busybox:1.36";
// The shell runs each command with exec; the container itself only has to stay up.
const KEEP_ALIVE_SECONDS = 86400;

export function buildNodeDebugArgs(target: NodeDebugSessionTarget) {
  const namespace = target.namespace?.trim() || "default";
  const image = target.image?.trim() || NODE_DEBUG_IMAGE;
  return [
    "debug",
    `node/${target.nodeName.trim()}`,
    "-n",
    namespace,
    "--profile=general",
    `--image=${image}`,
    "--",
    "sleep",
    String(KEEP_ALIVE_SECONDS),
  ];
}

/** kubectl names the pod itself: "Creating debugging pod node-debugger-<node>-<id> ...". */
export function parseNodeDebugPodName(output: string): string | null {
  return /Creating debugging pod (\S+)/.exec(output)?.[1] ?? null;
}

/** A readable cause when the debugger pod does not become Ready. */
export function describeNodeDebugFailure(
  waitingReason: string,
  image: string,
  fallback: string,
): string {
  const reason = waitingReason.trim();
  if (/ImagePull|ErrImage|InvalidImageName/.test(reason)) {
    return `Node shell did not start: the node could not pull ${image} (${reason}). The cluster needs access to that image.`;
  }
  if (reason) return `Node shell did not start: ${reason}.`;
  return fallback;
}

/** Pod Security (baseline or restricted) refuses the host namespaces a node shell needs. */
export function isPodSecurityRejection(message: string) {
  return /violates PodSecurity/i.test(message);
}

/**
 * Namespaces to try for the debug pod: the requested one, then kube-system. Many
 * clusters enforce Pod Security "baseline" on default, which refuses host namespaces;
 * kube-system is usually exempt. kubectl itself fails in that case.
 */
export function nodeDebugNamespaces(requested?: string | null) {
  const first = requested?.trim() || "default";
  return first === "kube-system" ? [first] : [first, "kube-system"];
}

export async function startNodeDebugSession(target: NodeDebugSessionTarget) {
  const clusterId = target.clusterId.trim();
  const nodeName = target.nodeName.trim();
  const image = target.image?.trim() || NODE_DEBUG_IMAGE;
  if (!clusterId || !nodeName) {
    throw new Error("Node shell requires a cluster id and a node name.");
  }

  let podName: string | null = null;
  let namespace = "";
  const refused: string[] = [];
  for (const candidate of nodeDebugNamespaces(target.namespace)) {
    const created = await kubectlRawArgsFront(
      buildNodeDebugArgs({ ...target, namespace: candidate }),
      { clusterId },
    );
    const output = `${created.output}\n${created.errors}`;
    if (created.code === 0 && parseNodeDebugPodName(output)) {
      podName = parseNodeDebugPodName(output);
      namespace = candidate;
      break;
    }
    if (!isPodSecurityRejection(created.errors)) {
      throw new Error(created.errors || "Failed to start a debug pod on the node.");
    }
    refused.push(candidate);
  }
  if (!podName) {
    throw new Error(
      `Node shell did not start: Pod Security in ${refused.join(" and ")} forbids the host namespaces a node debug pod needs. Allow privileged pods in one of them (pod-security.kubernetes.io/enforce=privileged).`,
    );
  }

  const ready = await kubectlRawArgsFront(buildPodDebugWaitArgs(podName, namespace), {
    clusterId,
  });
  if (ready.errors || ready.code !== 0) {
    const status = await kubectlRawArgsFront(
      [
        "get",
        "pod",
        podName,
        "-n",
        namespace,
        "-o",
        "jsonpath={.status.containerStatuses[0].state.waiting.reason}",
      ],
      { clusterId },
    ).catch(() => null);
    await kubectlRawArgsFront(buildPodDebugCleanupArgs(podName, namespace), { clusterId }).catch(
      () => undefined,
    );
    throw new Error(
      describeNodeDebugFailure(
        status?.output ?? "",
        image,
        ready.errors || "The debug pod on the node did not become Ready.",
      ),
    );
  }

  openPodDebugShellModal(
    clusterId,
    { metadata: { name: podName, namespace } },
    {
      cleanupPod: { name: podName, namespace },
      sessionLabel: `Node shell ${nodeName}`,
      notice: `Shell on node ${nodeName}: the node's file system is at /host (chroot /host for the node's own tools). Closing this window deletes the debug pod ${namespace}/${podName}.`,
    },
  );
  return { podName, namespace };
}
