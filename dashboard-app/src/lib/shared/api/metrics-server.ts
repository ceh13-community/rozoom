import { kubectlRawFront } from "$shared/api/kubectl-proxy";

const LABEL = "k8s-app=metrics-server";

type KubectlResult = { success: boolean; error?: string };

export async function deleteMetricsServerManifests(clusterId: string): Promise<KubectlResult> {
  const workloads = await kubectlRawFront(
    `delete deployment,service,serviceaccount -A -l ${LABEL}`,
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

  const apiService = await kubectlRawFront("delete apiservice -l k8s-app=metrics-server", {
    clusterId,
  });

  if (apiService.errors.length) {
    return { success: false, error: apiService.errors };
  }

  return { success: true };
}
