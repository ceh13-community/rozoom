import { canCopyCommandLine, formatCommandLine } from "$shared/lib/format-command-line";

export type KubectlTarget = {
  resource: string;
  name: string;
  namespace?: string;
  namespaceScoped?: boolean;
};

export type KubectlLogsTarget = {
  target: string;
  namespace?: string;
  container?: string;
  previous?: boolean;
  follow?: boolean;
  allPods?: boolean;
};

function getNamespace(namespace?: string) {
  const normalized = namespace?.trim();
  return normalized && normalized.length > 0 ? normalized : "default";
}

function getNamespaceArgs(target: KubectlTarget) {
  return target.namespaceScoped === false ? [] : ["-n", getNamespace(target.namespace)];
}

/** Commands for copying into a terminal. The name stays after `--`, so it is never a flag. */
export function buildKubectlGetYamlCommand(target: KubectlTarget) {
  return formatCommandLine([
    "kubectl",
    "get",
    target.resource,
    ...getNamespaceArgs(target),
    "-o",
    "yaml",
    "--",
    target.name,
  ]);
}

export function buildKubectlDescribeCommand(target: KubectlTarget) {
  return formatCommandLine([
    "kubectl",
    "describe",
    target.resource,
    ...getNamespaceArgs(target),
    "--",
    target.name,
  ]);
}

export function canCopyKubectlCommand(target: KubectlTarget, windows?: boolean) {
  return canCopyCommandLine([target.resource, ...getNamespaceArgs(target), target.name], windows);
}

export function buildKubectlLogsArgs(target: KubectlLogsTarget) {
  const args = [
    "logs",
    target.target,
    "--namespace",
    getNamespace(target.namespace),
    "--tail=400",
    "--timestamps=true",
  ];
  if (target.allPods) {
    args.push("--all-pods=true");
  }
  if (target.container && target.container !== "__all__") {
    args.push("--container", target.container);
  } else {
    args.push("--all-containers=true");
  }
  if (target.previous) {
    args.push(target.allPods ? "--previous=true" : "--previous");
  }
  if (target.follow) {
    args.push("-f");
  }
  return args;
}
