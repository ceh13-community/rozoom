import type { DeploymentItem } from "$shared";
import { buildKubectlLogsArgs } from "../common/kubectl-command-builder";

type DeploymentLogsOptions = {
  follow?: boolean;
  container?: string;
  previous?: boolean;
};

export function buildDeploymentLogsArgs(item: DeploymentItem, options: DeploymentLogsOptions = {}) {
  const name = item.metadata.name;
  if (!name) return null;
  return buildKubectlLogsArgs({
    target: `deployment/${name}`,
    namespace: item.metadata.namespace ?? "default",
    allPods: true,
    container: options.container,
    previous: options.previous,
    follow: options.follow,
  });
}

export function buildDeploymentPodFallbackLogsArgs(
  podName: string,
  namespace: string,
  options: DeploymentLogsOptions = {},
) {
  return buildKubectlLogsArgs({
    target: podName,
    namespace,
    container: options.container,
    previous: options.previous,
    follow: options.follow,
  });
}
