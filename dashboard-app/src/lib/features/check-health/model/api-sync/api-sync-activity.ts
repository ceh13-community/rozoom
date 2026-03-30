import {
  activeResourceSyncClusterIds as activeApiSyncClusterIds,
  resetClusterRuntimeContext,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";

export { activeApiSyncClusterIds };

export function setActiveApiSyncClusters(clusterIds: string[]) {
  const nextClusterId = clusterIds.find((clusterId) => clusterId.trim().length > 0)?.trim() ?? null;
  setClusterRuntimeContext({
    activeClusterId: nextClusterId,
    resourceSyncEnabled: true,
  });
}

export function resetActiveApiSyncClusters() {
  resetClusterRuntimeContext();
}
