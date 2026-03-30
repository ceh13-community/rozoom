import type { AppClusterConfig } from "$entities/config/model/appConfig";

export function sortClustersArrayByState(clusters: AppClusterConfig[]) {
  return clusters.sort((a, b) => {
    if (a.offline && !b.offline) return 1;
    if (!a.offline && b.offline) return -1;

    return 0;
  });
}
