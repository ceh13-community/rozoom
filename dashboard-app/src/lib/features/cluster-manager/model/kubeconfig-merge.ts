/**
 * Kubeconfig merge and deduplication.
 *
 * Based on: https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/
 *
 * Merges multiple kubeconfig files, detects duplicate contexts,
 * and resolves conflicts by keeping the most recently added entry.
 */

export type MergeConflict = {
  type: "context" | "cluster" | "user";
  name: string;
  sources: string[];
};

export type MergeResult = {
  contexts: Array<{ name: string; source: string }>;
  clusters: Array<{ name: string; source: string }>;
  users: Array<{ name: string; source: string }>;
  conflicts: MergeConflict[];
  duplicatesRemoved: number;
};

type KubeConfigInput = {
  source: string;
  contexts: Array<{ name: string; cluster: string; user: string }>;
  clusters: Array<{ name: string }>;
  users: Array<{ name: string }>;
};

export function mergeKubeconfigs(configs: KubeConfigInput[]): MergeResult {
  const contextMap = new Map<string, { source: string; cluster: string; user: string }>();
  const clusterMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  const conflicts: MergeConflict[] = [];
  let duplicatesRemoved = 0;

  const contextSources = new Map<string, string[]>();
  const clusterSources = new Map<string, string[]>();
  const userSources = new Map<string, string[]>();

  for (const config of configs) {
    for (const ctx of config.contexts) {
      const sources = contextSources.get(ctx.name) ?? [];
      sources.push(config.source);
      contextSources.set(ctx.name, sources);

      if (contextMap.has(ctx.name)) {
        duplicatesRemoved++;
      }
      contextMap.set(ctx.name, { source: config.source, cluster: ctx.cluster, user: ctx.user });
    }

    for (const cluster of config.clusters) {
      const sources = clusterSources.get(cluster.name) ?? [];
      sources.push(config.source);
      clusterSources.set(cluster.name, sources);

      if (clusterMap.has(cluster.name)) {
        duplicatesRemoved++;
      }
      clusterMap.set(cluster.name, config.source);
    }

    for (const user of config.users) {
      const sources = userSources.get(user.name) ?? [];
      sources.push(config.source);
      userSources.set(user.name, sources);

      if (userMap.has(user.name)) {
        duplicatesRemoved++;
      }
      userMap.set(user.name, config.source);
    }
  }

  for (const [name, sources] of contextSources) {
    if (sources.length > 1) {
      conflicts.push({ type: "context", name, sources });
    }
  }
  for (const [name, sources] of clusterSources) {
    if (sources.length > 1) {
      conflicts.push({ type: "cluster", name, sources });
    }
  }
  for (const [name, sources] of userSources) {
    if (sources.length > 1) {
      conflicts.push({ type: "user", name, sources });
    }
  }

  return {
    contexts: Array.from(contextMap.entries()).map(([name, { source }]) => ({ name, source })),
    clusters: Array.from(clusterMap.entries()).map(([name, source]) => ({ name, source })),
    users: Array.from(userMap.entries()).map(([name, source]) => ({ name, source })),
    conflicts,
    duplicatesRemoved,
  };
}
