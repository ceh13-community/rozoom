import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

export type EditablePodRef = {
  name: string;
  namespace: string;
};

export type EditableTarget = {
  kind: string;
  namespace: string;
  name: string;
  ref: string;
};

export function kindToResource(kind: string) {
  const normalized = kind.toLowerCase();
  const map: Record<string, string> = {
    pod: "pod",
    deployment: "deployment",
    daemonset: "daemonset",
    statefulset: "statefulset",
    replicaset: "replicaset",
    job: "job",
    cronjob: "cronjob",
  };
  return map[normalized] ?? normalized;
}

function toTargetRef(kind: string, namespace: string, name: string) {
  return `${kind}/${namespace}/${name}`;
}

async function getControllerOwner(
  kind: string,
  name: string,
  namespace: string,
  clusterId: string,
): Promise<{ kind: string; name: string } | null> {
  const resource = kindToResource(kind);
  const response = await kubectlRawArgsFront(
    ["get", resource, name, "--namespace", namespace, "-o", "json"],
    { clusterId },
  );
  if (response.errors || response.code !== 0 || !response.output) {
    return null;
  }
  const parsed = JSON.parse(response.output) as {
    metadata?: { ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }> };
  };
  const owners = parsed.metadata?.ownerReferences ?? [];
  const owner =
    owners.find((item) => item.controller && item.kind && item.name) ??
    owners.find((item) => item.kind && item.name);
  if (!owner?.kind || !owner.name) return null;
  return { kind: owner.kind, name: owner.name };
}

export async function resolveEditableTarget(
  clusterId: string | undefined,
  pod: EditablePodRef,
): Promise<EditableTarget> {
  if (!clusterId) {
    return {
      kind: "pod",
      namespace: pod.namespace,
      name: pod.name,
      ref: toTargetRef("pod", pod.namespace, pod.name),
    };
  }
  try {
    const response = await kubectlRawArgsFront(
      ["get", "pod", pod.name, "--namespace", pod.namespace, "-o", "json"],
      { clusterId },
    );
    if (response.errors || response.code !== 0 || !response.output) {
      return {
        kind: "pod",
        namespace: pod.namespace,
        name: pod.name,
        ref: toTargetRef("pod", pod.namespace, pod.name),
      };
    }

    const parsed = JSON.parse(response.output) as {
      metadata?: {
        ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
      };
    };
    const owners = parsed.metadata?.ownerReferences ?? [];
    const owner =
      owners.find((item) => item.controller && item.kind && item.name) ??
      owners.find((item) => item.kind && item.name);
    if (!owner?.kind || !owner.name) {
      return {
        kind: "pod",
        namespace: pod.namespace,
        name: pod.name,
        ref: toTargetRef("pod", pod.namespace, pod.name),
      };
    }

    if (owner.kind.toLowerCase() === "replicaset") {
      const parent = await getControllerOwner(owner.kind, owner.name, pod.namespace, clusterId);
      if (parent && parent.kind.toLowerCase() === "deployment" && parent.name) {
        return {
          kind: "deployment",
          namespace: pod.namespace,
          name: parent.name,
          ref: toTargetRef("deployment", pod.namespace, parent.name),
        };
      }
    }

    if (owner.kind.toLowerCase() === "job") {
      const parent = await getControllerOwner(owner.kind, owner.name, pod.namespace, clusterId);
      if (parent && parent.kind.toLowerCase() === "cronjob" && parent.name) {
        return {
          kind: "cronjob",
          namespace: pod.namespace,
          name: parent.name,
          ref: toTargetRef("cronjob", pod.namespace, parent.name),
        };
      }
    }

    return {
      kind: owner.kind.toLowerCase(),
      namespace: pod.namespace,
      name: owner.name,
      ref: toTargetRef(owner.kind.toLowerCase(), pod.namespace, owner.name),
    };
  } catch {
    return {
      kind: "pod",
      namespace: pod.namespace,
      name: pod.name,
      ref: toTargetRef("pod", pod.namespace, pod.name),
    };
  }
}
