import { openPodDebugShellModal } from "$features/shell";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

type PodDebugSessionTarget = {
  clusterId: string;
  name: string;
  namespace?: string | null;
  container?: string | null;
  image?: string | null;
};

const DEFAULT_DEBUG_IMAGE = "busybox:1.36";
const DEBUG_READY_TIMEOUT_SECONDS = 180;

function normalizeNamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildPodDebugCopyName(target: Pick<PodDebugSessionTarget, "name">) {
  const base = normalizeNamePart(target.name).slice(0, 36) || "pod";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `debug-copy-${base}-${suffix}`;
}

export function buildPodDebugSessionArgs(target: PodDebugSessionTarget, debugPodName: string) {
  const name = target.name.trim();
  const namespace = target.namespace?.trim() || "default";
  const image = target.image?.trim() || DEFAULT_DEBUG_IMAGE;
  const args = [
    "debug",
    `pod/${name}`,
    "-n",
    namespace,
    `--copy-to=${debugPodName}`,
    "--share-processes",
    `--image=${image}`,
  ];
  const container = target.container?.trim();
  if (container) {
    args.push(`--target=${container}`);
  }
  args.push("--", "/bin/sh");
  return args;
}

export function buildPodDebugWaitArgs(debugPodName: string, namespace: string) {
  return [
    "wait",
    "--for=condition=Ready",
    `pod/${debugPodName}`,
    "-n",
    namespace,
    `--timeout=${DEBUG_READY_TIMEOUT_SECONDS}s`,
  ];
}

export function buildPodDebugCleanupArgs(debugPodName: string, namespace: string) {
  return [
    "delete",
    "pod",
    debugPodName,
    "--namespace",
    namespace,
    "--ignore-not-found=true",
    "--grace-period=0",
    "--force",
  ];
}

export async function startPodDebugSession(target: PodDebugSessionTarget) {
  const clusterId = target.clusterId.trim();
  const name = target.name.trim();
  const namespace = target.namespace?.trim() || "default";
  if (!clusterId || !name) {
    throw new Error("Pod debug session requires cluster id and pod name.");
  }

  const debugPodName = buildPodDebugCopyName(target);
  const createResult = await kubectlRawArgsFront(buildPodDebugSessionArgs(target, debugPodName), {
    clusterId,
  });
  if (createResult.errors || createResult.code !== 0) {
    throw new Error(createResult.errors || "Failed to create pod debug session.");
  }

  const waitResult = await kubectlRawArgsFront(buildPodDebugWaitArgs(debugPodName, namespace), {
    clusterId,
  });
  if (waitResult.errors || waitResult.code !== 0) {
    await kubectlRawArgsFront(buildPodDebugCleanupArgs(debugPodName, namespace), {
      clusterId,
    }).catch(() => undefined);
    throw new Error(waitResult.errors || "Pod debug session did not become Ready.");
  }

  openPodDebugShellModal(
    clusterId,
    {
      metadata: {
        name: debugPodName,
        namespace,
      },
    },
    {
      cleanupPod: {
        name: debugPodName,
        namespace,
      },
      sessionLabel: `Debug session ${namespace}/${name}`,
    },
  );

  return {
    debugPodName,
    namespace,
  };
}

export type { PodDebugSessionTarget };
