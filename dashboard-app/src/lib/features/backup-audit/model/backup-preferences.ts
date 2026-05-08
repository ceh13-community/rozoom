import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const CLUSTER_BACKUP_ENABLED_KEY = "clusterBackupEnabled";

type BackupStates = Record<string, boolean>;

export async function loadClusterBackupEnabled(clusterId: string): Promise<boolean> {
  if (!clusterId) return false;
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const values = (await store.get(CLUSTER_BACKUP_ENABLED_KEY)) as BackupStates | null;
    const enabled = values?.[clusterId];
    return typeof enabled === "boolean" ? enabled : false;
  } catch {
    return false;
  }
}

export async function saveClusterBackupEnabled(clusterId: string, enabled: boolean): Promise<void> {
  if (!clusterId) return;
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const values = ((await store.get(CLUSTER_BACKUP_ENABLED_KEY)) as BackupStates | null) ?? {};
    values[clusterId] = enabled;
    await store.set(CLUSTER_BACKUP_ENABLED_KEY, values);
    await store.save();
  } catch (error) {
    console.warn("Failed to save backup enabled preference", error);
  }
}
