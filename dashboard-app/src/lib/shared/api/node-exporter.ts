import { kubectlRawFront } from "$shared/api/kubectl-proxy";

const LABEL = "app.kubernetes.io/name=prometheus-node-exporter";

type KubectlResult = { success: boolean; error?: string };

export async function deleteNodeExporterManifests(clusterId: string): Promise<KubectlResult> {
  const workloads = await kubectlRawFront(
    `delete daemonset,service,serviceaccount -A -l ${LABEL}`,
    { clusterId },
  );

  if (workloads.errors.length) {
    return { success: false, error: workloads.errors };
  }

  const roles = await kubectlRawFront(`delete clusterrole,clusterrolebinding -l ${LABEL}`, {
    clusterId,
  });

  if (roles.errors.length) {
    return { success: false, error: roles.errors };
  }

  const rolesInNamespaces = await kubectlRawFront(`delete role,rolebinding -A -l ${LABEL}`, {
    clusterId,
  });

  if (rolesInNamespaces.errors.length) {
    return { success: false, error: rolesInNamespaces.errors };
  }

  return { success: true };
}
