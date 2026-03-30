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

export function buildKubectlGetYamlCommand(target: KubectlTarget) {
  if (target.namespaceScoped === false) {
    return `kubectl get ${target.resource} ${target.name} -o yaml`;
  }
  return `kubectl get ${target.resource} ${target.name} -n ${getNamespace(target.namespace)} -o yaml`;
}

export function buildKubectlDescribeCommand(target: KubectlTarget) {
  if (target.namespaceScoped === false) {
    return `kubectl describe ${target.resource} ${target.name}`;
  }
  return `kubectl describe ${target.resource} ${target.name} -n ${getNamespace(target.namespace)}`;
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
