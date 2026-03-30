import type { AppClusterConfig } from "$entities/config";
import { storeManager } from "$shared/store";

const CLUSTERS_STORE_FILE = "clusters.json";
const CLUSTERS_KEY = "clusters";
const REMOVED_CLUSTERS_KEY = "removedClusters";

export async function loadConfig(): Promise<AppClusterConfig[] | []> {
  const store = await storeManager.getStore(CLUSTERS_STORE_FILE);
  const data = (await store.get(CLUSTERS_KEY)) as AppClusterConfig[] | null;
  return data ?? [];
}

export async function saveConfig(configData: AppClusterConfig[]) {
  const store = await storeManager.getStore(CLUSTERS_STORE_FILE);
  await store.set(CLUSTERS_KEY, configData);
  await store.save();
}

export async function loadRemovedConfig(): Promise<AppClusterConfig[]> {
  const store = await storeManager.getStore(CLUSTERS_STORE_FILE);
  const data = (await store.get(REMOVED_CLUSTERS_KEY)) as AppClusterConfig[] | null;
  return data ?? [];
}

export async function saveRemovedConfig(configData: AppClusterConfig[]) {
  const store = await storeManager.getStore(CLUSTERS_STORE_FILE);
  await store.set(REMOVED_CLUSTERS_KEY, configData);
  await store.save();
}
