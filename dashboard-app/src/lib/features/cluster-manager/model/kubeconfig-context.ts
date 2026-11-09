import type { KubeConfigFileType } from "$entities/config";

/**
 * The one rule for "which context stands for this cluster" on the first screen.
 *
 * The row (Context:, auth method), Check and Add must all use the same context, or Check
 * reports Ready for credentials that Add never imports (reviewer finding 5, GKFjp7g8,
 * stand with two contexts on one cluster). Rule: the kubeconfig's current-context when it
 * points at the cluster, otherwise the first context in file order that does.
 */
export function selectContextForCluster(
  config: Pick<KubeConfigFileType, "contexts" | "currentContext">,
  clusterName: string,
) {
  const candidates = config.contexts.filter((ctx) => ctx.context.cluster === clusterName);
  if (candidates.length === 0) return null;
  const current = config.currentContext
    ? candidates.find((ctx) => ctx.name === config.currentContext)
    : undefined;
  return current ?? candidates[0];
}

/**
 * `--kubeconfig` for kubectl calls about a listed cluster. The default list comes from
 * `kubectl config view`, which already merged $KUBECONFIG and ~/.kube/config; pointing
 * kubectl at ~/.kube/config again would read a different file than the list was built
 * from (reviewer stand: Ready about another cluster with another user's plugin). So a
 * config without an explicit path yields no flag and kubectl resolves it the same way.
 */
export function kubeconfigArgs(kubeconfigPath: string | null | undefined): string[] {
  return kubeconfigPath ? [`--kubeconfig=${kubeconfigPath}`] : [];
}
