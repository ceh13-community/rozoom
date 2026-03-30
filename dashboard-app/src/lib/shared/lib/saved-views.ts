import { storeManager } from "$shared/store";

const STORE_NAME = "dashboard-preferences.json";
const VIEWS_KEY = "savedViews";
const ACTIVE_VIEW_KEY = "activeViewId";

export type SavedViewFilters = {
  search?: string;
  envFilter?: string;
  providerFilter?: string;
  statusFilter?: string;
  tagFilter?: string;
  groupId?: string;
};

export type SavedView = {
  id: string;
  name: string;
  filters: SavedViewFilters;
  isDefault?: boolean;
};

export async function loadSavedViews(): Promise<SavedView[]> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(VIEWS_KEY)) as SavedView[] | null;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function saveSavedViews(views: SavedView[]) {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    await store.set(VIEWS_KEY, views);
    await store.save();
  } catch {
    // best-effort
  }
}

export async function loadActiveViewId(): Promise<string | null> {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    const value = (await store.get(ACTIVE_VIEW_KEY)) as string | null;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export async function saveActiveViewId(viewId: string | null) {
  try {
    const store = await storeManager.getStore(STORE_NAME);
    // @ts-expect-error store API accepts string | null
    await store.set(ACTIVE_VIEW_KEY, viewId);
    await store.save();
  } catch {
    // best-effort
  }
}

export function createView(name: string, filters: SavedViewFilters): SavedView {
  return { id: crypto.randomUUID(), name, filters };
}

export function addView(views: SavedView[], name: string, filters: SavedViewFilters): SavedView[] {
  return [...views, createView(name, filters)];
}

export function removeView(views: SavedView[], viewId: string): SavedView[] {
  return views.filter((v) => v.id !== viewId);
}

export function updateView(
  views: SavedView[],
  viewId: string,
  updates: Partial<Pick<SavedView, "name" | "filters">>,
): SavedView[] {
  return views.map((v) => {
    if (v.id !== viewId) return v;
    return {
      ...v,
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.filters !== undefined ? { filters: updates.filters } : {}),
    };
  });
}

export function setDefaultView(views: SavedView[], viewId: string): SavedView[] {
  return views.map((v) => ({
    ...v,
    isDefault: v.id === viewId,
  }));
}

export function getDefaultView(views: SavedView[]): SavedView | undefined {
  return views.find((v) => v.isDefault);
}

type ClusterLike = {
  uuid: string;
  name: string;
  provider?: string;
  env?: string;
  tags?: string[];
  offline?: boolean;
};

export function applyViewFilters<T extends ClusterLike>(
  clusters: T[],
  filters: SavedViewFilters,
  groupMembership?: Record<string, string>,
): T[] {
  return clusters.filter((cluster) => {
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const name = cluster.name.toLowerCase();
      if (!name.includes(query)) return false;
    }

    if (filters.envFilter && filters.envFilter !== "all") {
      if ((cluster.env ?? "shared") !== filters.envFilter) return false;
    }

    if (filters.providerFilter && filters.providerFilter !== "all") {
      if ((cluster.provider ?? "") !== filters.providerFilter) return false;
    }

    if (filters.statusFilter && filters.statusFilter !== "all") {
      const isOffline = cluster.offline ?? false;
      if (filters.statusFilter === "online" && isOffline) return false;
      if (filters.statusFilter === "offline" && !isOffline) return false;
    }

    if (filters.tagFilter) {
      const tags = cluster.tags ?? [];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- verified by outer if (filters.tagFilter) check
      if (!tags.some((t) => t.toLowerCase() === filters.tagFilter!.toLowerCase())) return false;
    }

    if (filters.groupId && groupMembership) {
      if (groupMembership[cluster.uuid] !== filters.groupId) return false;
    }

    return true;
  });
}
