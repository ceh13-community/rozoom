import { storeManager } from "$shared/store";

const DASHBOARD_PREFERENCES_STORE = "dashboard-preferences.json";
const CARD_VERSION_KEY = "dashboardCardVersion";
const VIEW_MODE_KEY = "dashboardViewMode";
const CLUSTER_CARD_SECTIONS_KEY = "clusterCardSections";

type SectionStates = Record<string, boolean>;
type AllSectionStates = Record<string, SectionStates>;

export type CardVersion = "compact" | "detailed";
export type ViewMode = "list" | "grid";

const VALID_CARD_VERSIONS = new Set<string>(["compact", "detailed"]);
const VALID_VIEW_MODES = new Set<string>(["list", "grid"]);

export async function loadDashboardCardVersion(): Promise<CardVersion | null> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const value = (await store.get(CARD_VERSION_KEY)) as string | null;
    return VALID_CARD_VERSIONS.has(value ?? "") ? (value as CardVersion) : null;
  } catch {
    return null;
  }
}

export async function saveDashboardCardVersion(version: CardVersion): Promise<void> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    await store.set(CARD_VERSION_KEY, version);
    await store.save();
  } catch (error) {
    console.warn("Failed to save card version preference", error);
  }
}

export async function loadDashboardViewMode(): Promise<ViewMode | null> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const value = (await store.get(VIEW_MODE_KEY)) as string | null;
    return VALID_VIEW_MODES.has(value ?? "") ? (value as ViewMode) : null;
  } catch {
    return null;
  }
}

export async function saveDashboardViewMode(mode: ViewMode): Promise<void> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    await store.set(VIEW_MODE_KEY, mode);
    await store.save();
  } catch (error) {
    console.warn("Failed to save view mode preference", error);
  }
}

export async function loadClusterCardSections(clusterId: string): Promise<SectionStates | null> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const all = (await store.get(CLUSTER_CARD_SECTIONS_KEY)) as AllSectionStates | null;
    return all?.[clusterId] ?? null;
  } catch {
    return null;
  }
}

export async function saveClusterCardSections(
  clusterId: string,
  sections: SectionStates,
): Promise<void> {
  try {
    const store = await storeManager.getStore(DASHBOARD_PREFERENCES_STORE);
    const all = ((await store.get(CLUSTER_CARD_SECTIONS_KEY)) as AllSectionStates | null) ?? {};
    all[clusterId] = sections;
    await store.set(CLUSTER_CARD_SECTIONS_KEY, all);
    await store.save();
  } catch (error) {
    console.warn("Failed to save card section state", error);
  }
}
