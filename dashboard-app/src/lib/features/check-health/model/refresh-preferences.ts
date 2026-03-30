import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const CLUSTER_REFRESH_KEY = "clusterRefreshIntervals";

type RefreshIntervals = Record<string, number>;

export async function loadClusterRefreshInterval(clusterId: string): Promise<number | null> {
  if (!clusterId) return null;

  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const values = (await store.get(CLUSTER_REFRESH_KEY)) as RefreshIntervals | null;
    const interval = values?.[clusterId];
    if (typeof interval !== "number") return null;

    return Number.isFinite(interval) ? interval : null;
  } catch (error) {
    console.error("Failed to load refresh interval preference", error);
    return null;
  }
}

export async function saveClusterRefreshInterval(clusterId: string, intervalMinutes: number) {
  if (!clusterId || !Number.isFinite(intervalMinutes)) return;

  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const values = ((await store.get(CLUSTER_REFRESH_KEY)) as RefreshIntervals | null) ?? {};

    values[clusterId] = intervalMinutes;

    await store.set(CLUSTER_REFRESH_KEY, values);
    await store.save();
  } catch (error) {
    console.error("Failed to save refresh interval preference", error);
  }
}
