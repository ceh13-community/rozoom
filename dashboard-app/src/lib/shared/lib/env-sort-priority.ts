import { writable, get } from "svelte/store";
import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const ENV_PRIORITY_KEY = "envSortPriority";

// Default: prod first (monitoring-oriented). Users can reorder.
const DEFAULT_ENV_PRIORITY: string[] = [
  "prod",
  "production",
  "qual",
  "qa",
  "uat",
  "staging",
  "stage",
  "test",
  "testing",
  "int",
  "integration",
  "dev",
  "development",
  "sandbox",
  "shared",
  "local",
];

export const envSortPriority = writable<string[]>(DEFAULT_ENV_PRIORITY);

export async function loadEnvSortPriority(): Promise<void> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const saved = (await store.get(ENV_PRIORITY_KEY)) as string[] | null;
    if (Array.isArray(saved) && saved.length > 0) {
      envSortPriority.set(saved);
    }
  } catch {
    // Use defaults
  }
}

export async function saveEnvSortPriority(priority: string[]): Promise<void> {
  envSortPriority.set(priority);
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    await store.set(ENV_PRIORITY_KEY, priority);
    await store.save();
  } catch (error) {
    console.error("Failed to save env sort priority", error);
  }
}

export async function resetEnvSortPriority(): Promise<void> {
  await saveEnvSortPriority([...DEFAULT_ENV_PRIORITY]);
}

export function addCustomEnv(env: string): void {
  const current = get(envSortPriority);
  const normalized = env.trim().toLowerCase();
  if (!normalized || current.includes(normalized)) return;
  const updated = [...current, normalized];
  void saveEnvSortPriority(updated);
}

export function removeEnv(env: string): void {
  const current = get(envSortPriority);
  void saveEnvSortPriority(current.filter((e) => e !== env));
}

export function moveEnv(env: string, direction: "up" | "down"): void {
  const current = [...get(envSortPriority)];
  const index = current.indexOf(env);
  if (index < 0) return;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= current.length) return;
  [current[index], current[target]] = [current[target], current[index]];
  void saveEnvSortPriority(current);
}

/**
 * Returns the sort priority for a given env string.
 * Lower number = higher priority (appears first).
 * Unknown envs get a high number and sort alphabetically among themselves.
 */
export function getEnvSortIndex(env: string | undefined | null): number {
  if (!env) return 9999;
  const priority = get(envSortPriority);
  const normalized = env.trim().toLowerCase();
  const index = priority.indexOf(normalized);
  return index >= 0 ? index : 1000 + normalized.charCodeAt(0);
}

/**
 * Sort comparator for clusters by env priority, then by name.
 * Offline clusters always go last within their env group.
 */
export function compareClustersByEnv(
  a: { env?: string | null; name: string; offline?: boolean },
  b: { env?: string | null; name: string; offline?: boolean },
): number {
  // Offline always last
  if (a.offline && !b.offline) return 1;
  if (!a.offline && b.offline) return -1;

  // Sort by env priority
  const envDiff = getEnvSortIndex(a.env) - getEnvSortIndex(b.env);
  if (envDiff !== 0) return envDiff;

  // Within same env, alphabetical
  return a.name.localeCompare(b.name);
}

export { DEFAULT_ENV_PRIORITY };
