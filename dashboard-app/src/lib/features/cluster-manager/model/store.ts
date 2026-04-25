import { get, writable } from "svelte/store";
import type { AppClusterConfig, KubeCluster, KubeConfigFileType } from "$entities/config";
import { saveClusterOnDisk, saveKubeConfig, getClusterFromDisk } from "../api/disk";
import { formatResultMessages } from "../ui/formatters";
import { parseKubeconfigText } from "$entities/config";
import {
  loadConfig,
  saveConfig,
  loadRemovedConfig,
  saveRemovedConfig,
} from "../api/config-storage-repo";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import yaml from "js-yaml";

export const isClustersConfigLoading = writable(false);
export const clustersConfigError = writable<string | null>(null);
export const clustersConfigSuccess = writable<string | null>(null);
export const clustersList = writable<AppClusterConfig[]>([]);
export const removedClustersList = writable<AppClusterConfig[]>([]);

type FlattenedKubeconfig = {
  clusters?: Array<{ name?: string }>;
  contexts?: Array<{ name?: string; context?: { cluster?: string } }>;
  "current-context"?: string;
};

function extractFlattenedClusterName(rawYaml: string): string | null {
  if (!rawYaml.trim()) return null;
  const parsed = yaml.load(rawYaml) as FlattenedKubeconfig | null;
  if (!parsed || typeof parsed !== "object") return null;

  const currentContextName =
    typeof parsed["current-context"] === "string" ? parsed["current-context"] : null;
  const currentContext = currentContextName
    ? parsed.contexts?.find((entry) => entry.name === currentContextName)
    : null;
  const currentClusterName = currentContext?.context?.cluster;
  if (typeof currentClusterName === "string" && currentClusterName.trim().length > 0) {
    return currentClusterName;
  }
  const firstCluster = parsed.clusters?.[0]?.name;
  return typeof firstCluster === "string" && firstCluster.trim().length > 0 ? firstCluster : null;
}

export async function loadClusters(): Promise<AppClusterConfig[] | []> {
  clearClustersConfigMessages();
  isClustersConfigLoading.set(true);
  const data = await loadConfig();
  const removed = await loadRemovedConfig();

  if (data.length) clustersList.set(data);
  if (removed.length) removedClustersList.set(removed);

  isClustersConfigLoading.set(false);

  return data;
}

async function saveClusters(clusters: AppClusterConfig[]): Promise<void> {
  clearClustersConfigMessages();

  try {
    await saveConfig(clusters);
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : `Failed to save configuration: ${(err as Error).message}`;
    clustersConfigError.set(errorMessage);
  }
}

/**
 * Fire one health check against a freshly-added cluster and clear its
 * needsInitialRefreshHint flag once the attempt settles (success or
 * failure). Without this the card stays in 'No diagnostics yet' state
 * until the user manually clicks the refresh button, which has been a
 * recurring confusion: users expect auto-refresh to start immediately.
 *
 * Dynamic imports keep the cluster-manager feature free of a static
 * dep on the check-health module graph so the two can still be loaded
 * independently on cold starts.
 */
async function triggerInitialHealthCheck(uuid: string): Promise<void> {
  try {
    const { updateClusterHealthChecks } = await import("$features/check-health");
    await updateClusterHealthChecks(uuid, { force: true });
  } catch {
    // Swallow - the card still works; the hint just stays until the
    // user clicks refresh. Errors from the check itself are already
    // surfaced via clusterStates.error.
  } finally {
    try {
      await markClusterRefreshHintSeen(uuid);
    } catch {
      // nothing to do
    }
  }
}

export async function addClustersFromKubeconfig(
  loadedConfig: KubeConfigFileType,
  kubeconfigPath: string,
): Promise<void> {
  clearClustersConfigMessages();

  try {
    await addClusters(loadedConfig, kubeconfigPath);
  } catch (err) {
    const errorMessage = `Failed to add clusters from kubeconfigs: ${(err as Error).message}`;
    clustersConfigError.set(errorMessage);
    console.error("Error with kubeconfigs:", err);
  }
}

export async function addClustersFromKubeconfigSelection(
  loadedConfig: KubeConfigFileType,
  kubeconfigPath: string,
  selections: Array<{
    name: string;
    displayName?: string;
    env?: string;
    provider?: string;
    source?: string;
    tags?: string[];
  }>,
): Promise<void> {
  clearClustersConfigMessages();

  const selectedNames = new Set(selections.map((selection) => selection.name));
  const metaByName = selections.reduce<Record<string, Partial<AppClusterConfig>>>(
    (acc, selection) => {
      acc[selection.name] = {
        displayName: selection.displayName,
        env: selection.env,
        provider: selection.provider,
        source: selection.source,
        tags: selection.tags,
      };
      return acc;
    },
    {},
  );

  try {
    await addClusters(loadedConfig, kubeconfigPath, {
      selectedNames,
      metaByName,
    });
  } catch (err) {
    const errorMessage = `Failed to add selected clusters: ${(err as Error).message}`;
    clustersConfigError.set(errorMessage);
    console.error("Error with kubeconfig selections:", err);
  }
}

export async function addClustersFromText(configText: string): Promise<void> {
  const config = await parseKubeconfigText(configText);
  const path = await saveKubeConfig(configText);

  if (!path) {
    clustersConfigError.set("Failed to save kubeconfig uploaded by user");
    return;
  }

  return addClustersFromKubeconfig(config, path);
}

async function addClusters(
  config: KubeConfigFileType,
  kubeconfigPath: string,
  options?: {
    selectedNames?: Set<string>;
    metaByName?: Record<string, Partial<AppClusterConfig>>;
  },
): Promise<void> {
  const result = {
    added: [] as string[],
    errors: [] as string[],
  };

  clearClustersConfigMessages();

  const clustersToAdd = options?.selectedNames
    ? config.clusters.filter((cluster) => options.selectedNames?.has(cluster.name))
    : config.clusters;

  await Promise.all(
    clustersToAdd.map(async (cluster) => {
      let addResult: string | null = null;
      try {
        addResult = addCluster(cluster, options?.metaByName?.[cluster.name]);

        if (addResult === null) {
          result.errors.push(`Cluster "${cluster.name}" already exists`);
          return;
        }

        const context = config.contexts.find((ctx) => ctx.context.cluster === cluster.name);
        if (!context?.name) {
          throw new Error(`No kubeconfig context found for cluster "${cluster.name}"`);
        }

        const yaml = await kubectlRawFront(
          `config view --flatten --minify --context=${context.name} -o yaml --kubeconfig=${kubeconfigPath}`,
        );
        if (yaml.errors.trim()) {
          throw new Error(yaml.errors.trim());
        }
        const flattenedClusterName = extractFlattenedClusterName(yaml.output);
        if (flattenedClusterName !== cluster.name) {
          throw new Error(
            `Context "${context.name}" resolved to cluster "${flattenedClusterName ?? "unknown"}" instead of "${cluster.name}". Check the selected kubeconfig context before importing.`,
          );
        }

        await saveClusterOnDisk(addResult, yaml.output);

        result.added.push(cluster.name);
        // Kick off one health check in the background so the new card
        // stops showing 'No diagnostics yet' without the user having to
        // click the refresh button first. Dynamic import keeps cluster-
        // manager decoupled from the check-health module graph.
        void triggerInitialHealthCheck(addResult);
      } catch (error) {
        if (addResult) {
          clustersList.update((clusters) => clusters.filter((entry) => entry.uuid !== addResult));
        }
        result.errors.push(`${cluster.name}: ${(error as Error).message}`);
      }
    }),
  );

  if (result.added.length > 0) {
    try {
      await saveClusters(get(clustersList));
    } catch (error) {
      result.errors.push(`Failed to save configuration':
        ${(error as Error).message}`);
    }
  }

  if (result.errors.length > 0) {
    clustersConfigError.set(result.errors.join(". "));
  }

  if (result.added.length > 0) {
    const messages = formatResultMessages(result);
    clustersConfigSuccess.set(messages.join(". "));
  }
}

export function addCluster(
  cluster: KubeCluster,
  meta: Partial<AppClusterConfig> = {},
): string | null {
  if (findClusterByName(cluster.name)) {
    return null;
  }

  const uuid = crypto.randomUUID();
  const newCluster: AppClusterConfig = {
    uuid,
    name: cluster.name,
    addedAt: new Date(),
    needsInitialRefreshHint: true,
    ...meta,
  };

  clustersList.update((clusters) => [...clusters, newCluster]);

  return uuid;
}

export async function removeCluster(uuid: string) {
  const clusters = get(clustersList);
  const target = clusters.find((cluster) => cluster.uuid === uuid);

  if (!target) return;

  const filtered = clusters.filter((cluster) => cluster.uuid !== uuid);
  const removed = get(removedClustersList);

  target.removedAt = new Date().toISOString();
  removed.push(target);

  clustersList.set(filtered);
  removedClustersList.set(removed);

  await saveClusters(filtered);
  await saveRemovedConfig(removed);
}

export async function restoreCluster(uuid: string) {
  const removed = get(removedClustersList);
  const target = removed.find((cluster) => cluster.uuid === uuid);

  if (!target) return;

  const filteredRemoved = removed.filter((cluster) => cluster.uuid !== uuid);
  delete target.removedAt;

  const clusters = get(clustersList);
  clusters.push(target);

  clustersList.set(clusters);
  removedClustersList.set(filteredRemoved);

  await saveClusters(clusters);
  await saveRemovedConfig(filteredRemoved);
}

export async function purgeCluster(uuid: string) {
  const removed = get(removedClustersList);
  const filteredRemoved = removed.filter((cluster) => cluster.uuid !== uuid);

  if (filteredRemoved.length === removed.length) return;

  removedClustersList.set(filteredRemoved);
  await saveRemovedConfig(filteredRemoved);
}

export async function toggleClusterState(uuid: string) {
  clearClustersConfigMessages();

  const clusters = get(clustersList);

  if (!clusters.length) {
    return;
  }

  const cluster = clusters.find((cluster) => cluster.uuid === uuid);

  if (!cluster) {
    return;
  }

  if (cluster.offline) {
    delete cluster.offline;
    cluster.lastSeenOnline = new Date();
  } else {
    cluster.offline = true;
  }

  clustersList.set(clusters);
  await saveClusters(clusters);

  clustersConfigSuccess.set(
    `Cluster "${cluster.name}" marked as ${cluster.offline ? "offline" : "online"}`,
  );
}

export async function toggleClusterPin(uuid: string) {
  clearClustersConfigMessages();

  const clusters = get(clustersList);
  const cluster = clusters.find((entry) => entry.uuid === uuid);

  if (!cluster) return;

  cluster.pinned = !cluster.pinned;
  clustersList.set(clusters);
  await saveClusters(clusters);
}

export async function markClusterRefreshHintSeen(uuid: string) {
  const clusters = get(clustersList);
  const cluster = clusters.find((entry) => entry.uuid === uuid);

  if (!cluster || !cluster.needsInitialRefreshHint) return;

  cluster.needsInitialRefreshHint = false;
  clustersList.set(clusters);
  await saveClusters(clusters);
}

export async function updateClusterMeta(
  uuid: string,
  meta: Partial<
    Pick<
      AppClusterConfig,
      | "displayName"
      | "env"
      | "tags"
      | "provider"
      | "defaultNamespace"
      | "readOnly"
      | "proxyUrl"
      | "pinnedKubectlVersion"
      | "pinnedHelmVersion"
    >
  >,
) {
  const clusters = get(clustersList);
  const cluster = clusters.find((entry) => entry.uuid === uuid);
  if (!cluster) return;

  if (meta.displayName !== undefined) cluster.displayName = meta.displayName;
  if (meta.env !== undefined) cluster.env = meta.env;
  if (meta.tags !== undefined) cluster.tags = meta.tags;
  if (meta.provider !== undefined) cluster.provider = meta.provider;
  if (meta.defaultNamespace !== undefined) cluster.defaultNamespace = meta.defaultNamespace;
  if (meta.readOnly !== undefined) cluster.readOnly = meta.readOnly;
  if (meta.proxyUrl !== undefined) cluster.proxyUrl = meta.proxyUrl;
  if (meta.pinnedKubectlVersion !== undefined)
    cluster.pinnedKubectlVersion = meta.pinnedKubectlVersion;
  if (meta.pinnedHelmVersion !== undefined) cluster.pinnedHelmVersion = meta.pinnedHelmVersion;

  clustersList.set(clusters);
  await saveClusters(clusters);
}

export function clearClustersConfigMessages(): void {
  clustersConfigError.set(null);
  clustersConfigSuccess.set(null);
}

export async function renameClusterContext(uuid: string, newName: string): Promise<boolean> {
  const clusters = get(clustersList);
  const cluster = clusters.find((entry) => entry.uuid === uuid);
  if (!cluster) return false;

  const existingConfig = await getClusterFromDisk(uuid);
  if (!existingConfig) return false;

  const oldName = cluster.name;
  const renamed = existingConfig.replace(
    new RegExp(`(current-context:\\s*)${escapeRegExp(oldName)}`),
    `$1${newName}`,
  );
  const updatedConfig = renamed
    .replace(new RegExp(`(name:\\s*)${escapeRegExp(oldName)}`), `$1${newName}`)
    .replace(new RegExp(`(cluster:\\s*)${escapeRegExp(oldName)}`), `$1${newName}`);

  await saveClusterOnDisk(uuid, updatedConfig);
  cluster.name = newName;
  if (!cluster.displayName) {
    cluster.displayName = newName;
  }
  clustersList.set(clusters);
  await saveClusters(clusters);
  return true;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findClusterByName(name: string): AppClusterConfig | undefined {
  const clusters = get(clustersList);
  return clusters.find((cluster) => cluster.name === name);
}

export function findClusterByUuid(uuid: string): AppClusterConfig | undefined {
  const clusters = get(clustersList);
  return clusters.find((cluster) => cluster.uuid === uuid);
}
