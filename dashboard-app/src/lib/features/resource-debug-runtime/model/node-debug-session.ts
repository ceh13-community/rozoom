// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { openPodDebugShellModal } from "$features/shell";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { buildPodDebugCleanupArgs, buildPodDebugWaitArgs } from "./pod-debug-session";

/**
 * Node shell the way `kubectl debug node/<name>` gives one: a pod on that node with the
 * host's PID, network and IPC namespaces and its root file system at /host. The pod runs
 * until the shell window closes, which deletes it. A pod left behind (the app was killed)
 * is labelled with this installation and run, and removed the next time the app connects
 * to the cluster; its own sleep ends it after two hours at the latest.
 */
export type NodeDebugSessionTarget = {
  clusterId: string;
  nodeName: string;
  /** Namespace the debugger pod is created in. */
  namespace?: string | null;
  image?: string | null;
};

// Pinned by digest: this image runs as root on the node.
export const NODE_DEBUG_IMAGE =
  "busybox:1.36.1@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662";
const NODE_DEBUG_IMAGE_LABEL = "busybox 1.36.1";
// The shell runs each command with exec; the container itself only has to stay up.
const KEEP_ALIVE_SECONDS = 7200;

export const DEBUG_OWNER_LABEL = "rozoom.app/debug-owner";
export const DEBUG_SESSION_LABEL = "rozoom.app/debug-session";
const DEBUG_OWNER_STORAGE_KEY = "rozoom:debug-owner-id";

function randomId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** This run of the app. A labelled pod from another run has no open shell any more. */
export const NODE_DEBUG_RUN_ID = randomId();

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** This installation, so the cleanup never touches debug pods of other people's apps. */
export function getDebugOwnerId(storage?: Pick<Storage, "getItem" | "setItem">): string {
  const store = storage ?? browserStorage();
  const saved = store?.getItem(DEBUG_OWNER_STORAGE_KEY);
  if (saved) return saved;
  const created = randomId();
  store?.setItem(DEBUG_OWNER_STORAGE_KEY, created);
  return created;
}

export function buildDebugPodLabelArgs(podName: string, namespace: string, ownerId: string) {
  return [
    "label",
    "pod",
    podName,
    "-n",
    namespace,
    `${DEBUG_OWNER_LABEL}=${ownerId}`,
    `${DEBUG_SESSION_LABEL}=${NODE_DEBUG_RUN_ID}`,
    "--overwrite",
  ];
}

/** Deletes this installation's debug pods in a namespace that belong to an earlier run. */
export function buildOrphanCleanupArgs(namespace: string, ownerId: string) {
  return [
    "delete",
    "pods",
    "-n",
    namespace,
    "-l",
    `${DEBUG_OWNER_LABEL}=${ownerId},${DEBUG_SESSION_LABEL}!=${NODE_DEBUG_RUN_ID}`,
    "--ignore-not-found",
    "--wait=false",
  ];
}

const cleanedClusters = new Set<string>();

/**
 * Removes node debug pods an earlier run of this app left behind (it was closed or
 * killed with a node shell open). Runs once per cluster per run, when the app connects.
 */
export async function cleanupOrphanNodeDebugPods(clusterId: string) {
  const id = clusterId.trim();
  if (!id || cleanedClusters.has(id)) return;
  cleanedClusters.add(id);
  const ownerId = getDebugOwnerId();
  for (const namespace of nodeDebugNamespaces()) {
    await kubectlRawArgsFront(buildOrphanCleanupArgs(namespace, ownerId), { clusterId: id }).catch(
      () => undefined,
    );
  }
}

/** Forgets which clusters were cleaned (tests). */
export function resetNodeDebugCleanupForTests() {
  cleanedClusters.clear();
}

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

/**
 * Debug pods of this node created around `sinceMs` (server time, with a margin for clock
 * skew), from `name<TAB>creationTimestamp` lines. Used when kubectl succeeded but did not
 * name its pod: nothing else tells which pod to remove.
 */
export function pickUnnamedNodeDebugPods(listing: string, nodeName: string, sinceMs: number) {
  const prefix = `node-debugger-${nodeName}-`;
  const margin = 60_000;
  return listing
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([name = "", created = ""]) => {
      const at = Date.parse(created);
      return name.startsWith(prefix) && Number.isFinite(at) && at >= sinceMs - margin;
    })
    .map(([name = ""]) => name);
}

async function removeUnnamedNodeDebugPods(
  clusterId: string,
  namespace: string,
  nodeName: string,
  sinceMs: number,
) {
  const listing = await kubectlRawArgsFront(
    [
      "get",
      "pods",
      "-n",
      namespace,
      "-o",
      'jsonpath={range .items[*]}{.metadata.name}{"\\t"}{.metadata.creationTimestamp}{"\\n"}{end}',
    ],
    { clusterId },
  ).catch(() => null);
  for (const name of pickUnnamedNodeDebugPods(listing?.output ?? "", nodeName, sinceMs)) {
    await kubectlRawArgsFront(buildPodDebugCleanupArgs(name, namespace), { clusterId }).catch(
      () => undefined,
    );
  }
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

/** Asks the user; resolves true to go on. The UI passes its confirm dialog. */
export type NodeDebugConfirm = (message: string, title: string) => Promise<boolean>;

export function describeNodeShellConfirm(nodeName: string, namespace: string) {
  return `Open a root shell on node ${nodeName}?\n\nStarts a privileged debug pod (${NODE_DEBUG_IMAGE_LABEL}) on the node in namespace ${namespace}. It shares the node's processes and network and mounts the node's file system at /host: commands in this shell run as root on the node. The pod is deleted when you close the shell window, and stops by itself after 2 hours.`;
}

/** The Pod Security part of kubectl's refusal, without its log prefix. */
export function podSecurityReason(errors: string) {
  return (
    /violates PodSecurity[^\n]*/i.exec(errors)?.[0] ??
    errors.replace(/^\[ERROR\] \[[^\]]*\]:\s*/, "").split("\n")[0]
  );
}

export function describeNamespaceFallbackConfirm(refused: string, reason: string, next: string) {
  return `Pod Security in ${refused} refused the debug pod: ${reason}\n\nCreate it in ${next} instead? ${next} is usually exempt from Pod Security. The pod is still deleted when you close the shell window.`;
}

/**
 * Opens a node shell after the user confirmed it. Returns null when the user declined,
 * at the start or when asked to use kube-system after Pod Security refused the pod.
 */
export async function startNodeDebugSession(
  target: NodeDebugSessionTarget,
  options: { confirm: NodeDebugConfirm; onProgress?: (message: string) => void },
): Promise<{ podName: string; namespace: string } | null> {
  const clusterId = target.clusterId.trim();
  const nodeName = target.nodeName.trim();
  const image = target.image?.trim() || NODE_DEBUG_IMAGE;
  if (!clusterId || !nodeName) {
    throw new Error("Node shell requires a cluster id and a node name.");
  }
  const candidates = nodeDebugNamespaces(target.namespace);
  if (
    !(await options.confirm(
      describeNodeShellConfirm(nodeName, candidates[0] ?? "default"),
      "Confirm node shell",
    ))
  ) {
    return null;
  }

  let podName: string | null = null;
  let namespace = "";
  let refusedReason = "";
  const refused: string[] = [];
  for (const candidate of candidates) {
    const previous = refused.at(-1);
    if (previous) {
      const approved = await options.confirm(
        describeNamespaceFallbackConfirm(previous, refusedReason, candidate),
        `Node shell in ${candidate}?`,
      );
      if (!approved) return null;
    }
    options.onProgress?.(`Starting a debug pod on node ${nodeName} in ${candidate}...`);
    const startedAt = Date.now();
    const created = await kubectlRawArgsFront(
      buildNodeDebugArgs({ ...target, namespace: candidate }),
      { clusterId },
    );
    const output = `${created.output}\n${created.errors}`;
    if (created.code === 0) {
      podName = parseNodeDebugPodName(output);
      if (!podName) {
        await removeUnnamedNodeDebugPods(clusterId, candidate, nodeName, startedAt);
        throw new Error(
          "Node shell did not start: kubectl did not name the debug pod it created. Debug pods it left on the node were removed.",
        );
      }
      namespace = candidate;
      break;
    }
    if (!isPodSecurityRejection(created.errors)) {
      throw new Error(created.errors || "Failed to start a debug pod on the node.");
    }
    refused.push(candidate);
    refusedReason = podSecurityReason(created.errors);
  }
  if (!podName) {
    throw new Error(
      `Node shell did not start: Pod Security in ${refused.join(" and ")} forbids the host namespaces a node debug pod needs. Allow privileged pods in one of them (pod-security.kubernetes.io/enforce=privileged).`,
    );
  }

  // Right away: if the app dies from here on, the next connect finds and removes the pod.
  await kubectlRawArgsFront(buildDebugPodLabelArgs(podName, namespace, getDebugOwnerId()), {
    clusterId,
  }).catch(() => undefined);

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
      notice: `Shell on node ${nodeName}: the node's file system is at /host (chroot /host for the node's own tools). Closing this window deletes the debug pod ${namespace}/${podName}; it stops by itself after 2 hours.`,
    },
  );
  return { podName, namespace };
}
