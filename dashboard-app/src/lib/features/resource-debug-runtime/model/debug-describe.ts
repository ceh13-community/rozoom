// eslint-disable-next-line no-restricted-imports -- legacy FSD violation, tech-debt (2026-08-20)
import { openDebugDescribeModal } from "$features/shell";
import { formatCommandLine } from "$shared/lib/format-command-line";

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

/**
 * kubectl arguments for describe. Names come from the cluster and are not limited to
 * what a command line can carry, so they stay one argument each, after `--`.
 */
export function buildDebugDescribeArgs(target: DebugDescribeTarget): string[] {
  const resource = normalizeResource(target.resource);
  const name = target.name;
  const namespace = target.namespace?.trim();
  if (!resource || !name.trim()) {
    throw new Error("Debug describe requires both resource and name.");
  }

  return ["describe", resource, ...(namespace ? ["-n", namespace] : []), "--", name];
}

export function buildDebugDescribeCommand(target: DebugDescribeTarget) {
  return formatCommandLine(["kubectl", ...buildDebugDescribeArgs(target)]);
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
    preset: {
      tool: "kubectl",
      args: buildDebugDescribeArgs(target),
      commandLine: buildDebugDescribeCommand(target),
    },
    sessionLabel: buildDebugDescribeLabel(target),
    targetNamespace: target.namespace?.trim() || "default",
  });
}
