import { writable } from "svelte/store";
import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const RUNTIME_DIAGNOSTICS_KEY = "showRuntimeDiagnostics";

export const showRuntimeDiagnostics = writable(false);

export async function loadShowRuntimeDiagnostics(): Promise<boolean> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const value = (await store.get(RUNTIME_DIAGNOSTICS_KEY)) as boolean | null;
    const enabled = typeof value === "boolean" ? value : false;
    showRuntimeDiagnostics.set(enabled);
    return enabled;
  } catch {
    return false;
  }
}

export async function saveShowRuntimeDiagnostics(enabled: boolean) {
  showRuntimeDiagnostics.set(enabled);
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    await store.set(RUNTIME_DIAGNOSTICS_KEY, enabled);
    await store.save();
  } catch {
    // ignore
  }
}
