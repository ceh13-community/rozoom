import { writable } from "svelte/store";
import { storeManager } from "$shared/store";
import { suppressCliNotifications } from "$shared/lib/cli-notification";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const RUNTIME_DIAGNOSTICS_KEY = "showRuntimeDiagnostics";
const CLI_NOTIFICATIONS_KEY = "showCliNotifications";

export const showRuntimeDiagnostics = writable(false);
export const showCliNotifications = writable(false);

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

export async function loadShowCliNotifications(): Promise<boolean> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const value = (await store.get(CLI_NOTIFICATIONS_KEY)) as boolean | null;
    const enabled = typeof value === "boolean" ? value : false;
    showCliNotifications.set(enabled);
    suppressCliNotifications(!enabled);
    return enabled;
  } catch {
    return false;
  }
}

export async function saveShowCliNotifications(enabled: boolean) {
  showCliNotifications.set(enabled);
  suppressCliNotifications(!enabled);
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    await store.set(CLI_NOTIFICATIONS_KEY, enabled);
    await store.save();
  } catch {
    // ignore
  }
}
