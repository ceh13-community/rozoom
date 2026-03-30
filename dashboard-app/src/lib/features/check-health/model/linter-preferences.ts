import { writable } from "svelte/store";
import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const CLUSTER_LINTER_KEY = "clusterLinterStates";
const GLOBAL_LINTER_KEY = "globalLinterEnabled";

type LinterStates = Record<string, boolean>;

export const globalLinterEnabled = writable(false);

export async function loadGlobalLinterEnabled(): Promise<boolean> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const value = (await store.get(GLOBAL_LINTER_KEY)) as boolean | null;
    const enabled = typeof value === "boolean" ? value : false;
    globalLinterEnabled.set(enabled);
    return enabled;
  } catch {
    return false;
  }
}

export async function saveGlobalLinterEnabled(enabled: boolean) {
  globalLinterEnabled.set(enabled);
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    await store.set(GLOBAL_LINTER_KEY, enabled);
    await store.save();
  } catch {
    // ignore
  }
}

export async function loadClusterLinterEnabled(clusterId: string): Promise<boolean> {
  if (!clusterId) return true;

  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const values = (await store.get(CLUSTER_LINTER_KEY)) as LinterStates | null;
    const enabled = values?.[clusterId];
    return typeof enabled === "boolean" ? enabled : true;
  } catch (error) {
    console.error("Failed to load linter preference", error);
    return true;
  }
}

export async function saveClusterLinterEnabled(clusterId: string, enabled: boolean) {
  if (!clusterId) return;

  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const values = ((await store.get(CLUSTER_LINTER_KEY)) as LinterStates | null) ?? {};

    values[clusterId] = enabled;

    await store.set(CLUSTER_LINTER_KEY, values);
    await store.save();
  } catch (error) {
    console.error("Failed to save linter preference", error);
  }
}
