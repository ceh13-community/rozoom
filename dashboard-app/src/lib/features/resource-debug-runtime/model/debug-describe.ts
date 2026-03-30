import { openDebugDescribeModal } from "$features/shell";

export type DebugDescribeTarget = {
  clusterId: string;
  resource: string;
  name: string;
  namespace?: string | null;
  title?: string;
};

function normalizeResource(resource: string) {
  return resource.trim().toLowerCase();
}

export function buildDebugDescribeCommand(target: DebugDescribeTarget) {
  const resource = normalizeResource(target.resource);
  const name = target.name.trim();
  const namespace = target.namespace?.trim();
  if (!resource || !name) {
    throw new Error("Debug describe requires both resource and name.");
  }

  return namespace
    ? `kubectl describe ${resource} ${name} -n ${namespace}`
    : `kubectl describe ${resource} ${name}`;
}

export function buildDebugDescribeLabel(target: DebugDescribeTarget) {
  const resource = normalizeResource(target.resource);
  const name = target.name.trim();
  const namespace = target.namespace?.trim();
  const subject = namespace ? `${namespace}/${name}` : name;
  return target.title?.trim() || `Describe ${resource} ${subject}`;
}

export function runDebugDescribe(target: DebugDescribeTarget) {
  const clusterId = target.clusterId.trim();
  if (!clusterId) {
    throw new Error("Debug describe requires a cluster id.");
  }

  openDebugDescribeModal(clusterId, {
    initialCommand: buildDebugDescribeCommand(target),
    sessionLabel: buildDebugDescribeLabel(target),
    targetNamespace: target.namespace?.trim() || "default",
  });
}
