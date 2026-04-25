import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const CLUSTER_REFRESH_KEY = "clusterRefreshIntervals";

type RefreshIntervals = Record<string, number>;

export interface RefreshIntervalOption {
  minutes: number;
  value: string;
  label: string;
  short: string;
}

// Canonical list of refresh-interval choices used by every cluster card and
// persisted into `clusterRefreshIntervals`. Keep the compact and detailed
// views synchronized - extend this array rather than inlining a copy.
export const REFRESH_INTERVAL_OPTIONS: readonly RefreshIntervalOption[] = [
  { minutes: 1, value: "1", label: "1 min", short: "1m" },
  { minutes: 5, value: "5", label: "5 min", short: "5m" },
  { minutes: 10, value: "10", label: "10 min", short: "10m" },
  { minutes: 15, value: "15", label: "15 min", short: "15m" },
  { minutes: 30, value: "30", label: "30 min", short: "30m" },
];

export const DEFAULT_REFRESH_INTERVAL_MINUTES = 5;

const VALID_REFRESH_INTERVAL_MINUTES = new Set<number>(
  REFRESH_INTERVAL_OPTIONS.map((option) => option.minutes),
);

export function isValidRefreshInterval(minutes: number | null | undefined): minutes is number {
  return typeof minutes === "number" && VALID_REFRESH_INTERVAL_MINUTES.has(minutes);
}

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
