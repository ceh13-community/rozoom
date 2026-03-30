import { browser } from "$app/environment";
import { getNamespaces } from "$shared/api/tauri";
import { setCacheWithTTL, getCache } from "$shared/cache";
import { debug, error } from "@tauri-apps/plugin-log";
import { writable } from "svelte/store";

const NAMESPACE_CACHE_PREFIX = "namespaces";
const NAMESPACE_SELECTIONS_STORAGE_KEY = "dashboard:namespace-selections:v1";
export const EMPTY_NAMESPACE_SELECTION = "__no_namespaces__";
const NAMESPACE_BACKGROUND_REFRESH_INTERVAL_MS = 60_000;
const NAMESPACE_MIN_REQUEST_GAP_MS = 15_000;
const namespaceSelections: Record<string, string> = loadPersistedNamespaceSelections();
const clusterNamespacesMap: Record<string, string[]> = {};
const namespaceRefreshTimestamps = new Map<string, number>();
const inFlightNamespaceLoads = new Map<string, Promise<void>>();
const namespaceRequestVersions = new Map<string, number>();
let loadedNamespaces: string[] = [];
let loadedNamespacesClusterId: string | null = null;

export const namespaces = writable<string[] | null>(null);
export const selectedNamespace = writable<string>("all");
export const isNamespacesLoading = writable(false);
export const namespacesError = writable<string | null>(null);

function arraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function getNamespaceRequestVersion(clusterId: string) {
  return namespaceRequestVersions.get(clusterId) ?? 0;
}

function bumpNamespaceRequestVersion(clusterId: string) {
  namespaceRequestVersions.set(clusterId, getNamespaceRequestVersion(clusterId) + 1);
}

function isNamespaceRequestCurrent(clusterId: string, version: number) {
  return getNamespaceRequestVersion(clusterId) === version;
}

function publishNamespaces(clusterId: string, nextNamespaces: string[]) {
  const normalizedSelection = normalizeSelection(
    namespaceSelections[clusterId] ?? "all",
    nextNamespaces,
  );
  const shouldUpdateNamespaces =
    loadedNamespacesClusterId !== clusterId || !arraysEqual(loadedNamespaces, nextNamespaces);

  loadedNamespacesClusterId = clusterId;
  if (shouldUpdateNamespaces) {
    loadedNamespaces = nextNamespaces;
    namespaces.set(nextNamespaces);
  }

  if (namespaceSelections[clusterId] !== normalizedSelection) {
    namespaceSelections[clusterId] = normalizedSelection;
    persistNamespaceSelections();
  }
  selectedNamespace.set(normalizedSelection);
}

function loadPersistedNamespaceSelections(): Record<string, string> {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(NAMESPACE_SELECTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistNamespaceSelections() {
  if (!browser) return;
  try {
    if (Object.keys(namespaceSelections).length === 0) {
      localStorage.removeItem(NAMESPACE_SELECTIONS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(NAMESPACE_SELECTIONS_STORAGE_KEY, JSON.stringify(namespaceSelections));
  } catch {
    // best-effort persistence
  }
}

function getCacheKey(clusterId: string) {
  return `${NAMESPACE_CACHE_PREFIX}:${clusterId}`;
}

function normalizeSelection(raw: string | null | undefined, available: string[]): string {
  if (raw === EMPTY_NAMESPACE_SELECTION) return EMPTY_NAMESPACE_SELECTION;
  // Backward compatibility with older persisted selection value.
  if (raw === "none" && !available.includes("none")) return EMPTY_NAMESPACE_SELECTION;
  if (!raw || raw === "all") return "all";
  const selected = Array.from(
    new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  if (selected.length === 0) return EMPTY_NAMESPACE_SELECTION;
  if (available.length === 0) return selected.join(",");
  const availableSet = new Set(available);
  const allowed = selected.filter((namespace) => availableSet.has(namespace));
  if (allowed.length === 0) return EMPTY_NAMESPACE_SELECTION;
  if (allowed.length === available.length) return "all";
  return allowed.join(",");
}

export function getSelectedNamespaceList(selection: string | null | undefined): string[] | null {
  if (!selection || selection === "all") return null;
  if (selection === EMPTY_NAMESPACE_SELECTION) return [];
  const selected = Array.from(
    new Set(
      selection
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
  return selected.length > 0 ? selected : null;
}

export function namespaceMatches(
  selection: string | null | undefined,
  namespace: string | null | undefined,
): boolean {
  const selected = getSelectedNamespaceList(selection);
  if (!selected) return true;
  if (selected.length === 0) return false;
  const value = namespace ?? "default";
  return selected.includes(value);
}

const loadClusterNamespaces = async (clusterId: string): Promise<string[]> => {
  const existing = inFlightNamespaceLoads.get(clusterId);
  if (existing) {
    await existing;
    return clusterNamespacesMap[clusterId] ?? [];
  }
  const lastRefresh = namespaceRefreshTimestamps.get(clusterId) ?? 0;
  if (Date.now() - lastRefresh < NAMESPACE_MIN_REQUEST_GAP_MS) {
    publishNamespaces(clusterId, clusterNamespacesMap[clusterId] ?? []);
    isNamespacesLoading.set(false);
    return clusterNamespacesMap[clusterId] ?? [];
  }

  const loadPromise = (async () => {
    isNamespacesLoading.set(true);
    namespacesError.set(null);
    namespaceRefreshTimestamps.set(clusterId, Date.now());
    const requestVersion = getNamespaceRequestVersion(clusterId);
    try {
      await debug(`Fetching namespaces for cluster ${clusterId}`);
      const namespacesData = await getNamespaces(clusterId);
      if (!isNamespaceRequestCurrent(clusterId, requestVersion)) {
        return clusterNamespacesMap[clusterId] ?? [];
      }
      const mergedNamespaces = namespacesData;
      if (!isNamespaceRequestCurrent(clusterId, requestVersion)) {
        return clusterNamespacesMap[clusterId] ?? [];
      }
      await setClusterNamespaces(clusterId, mergedNamespaces);
      return mergedNamespaces;
    } catch (err) {
      if (!isNamespaceRequestCurrent(clusterId, requestVersion)) {
        return clusterNamespacesMap[clusterId] ?? [];
      }
      const errorMessage = err instanceof Error ? err.message : "Failed to load namespaces";
      const fallbackNamespaces = clusterNamespacesMap[clusterId] ?? [];
      if (!isNamespaceRequestCurrent(clusterId, requestVersion)) {
        return clusterNamespacesMap[clusterId] ?? [];
      }
      namespacesError.set(errorMessage);
      publishNamespaces(clusterId, fallbackNamespaces);
      await error(errorMessage);
      return fallbackNamespaces;
    } finally {
      isNamespacesLoading.set(false);
      inFlightNamespaceLoads.delete(clusterId);
    }
  })();

  inFlightNamespaceLoads.set(
    clusterId,
    loadPromise.then(() => undefined),
  );
  await loadPromise;
  return clusterNamespacesMap[clusterId] ?? [];
};

export async function setClusterNamespaces(clusterId: string, namespacesData: string[]) {
  const normalizedNamespaces = Array.from(new Set(namespacesData)).sort((left, right) =>
    left.localeCompare(right),
  );
  clusterNamespacesMap[clusterId] = normalizedNamespaces;
  publishNamespaces(clusterId, normalizedNamespaces);
  await setCacheWithTTL(getCacheKey(clusterId), normalizedNamespaces, 1);
}

export async function getClusterNamespaces(clusterId: string) {
  const cacheKey = getCacheKey(clusterId);
  const inMemoryNamespaces = clusterNamespacesMap[clusterId] ?? [];
  const now = Date.now();
  const lastRefresh = namespaceRefreshTimestamps.get(clusterId) ?? 0;
  const existing = inFlightNamespaceLoads.get(clusterId);

  if (existing) {
    await existing;
    return clusterNamespacesMap[clusterId] ?? inMemoryNamespaces;
  }

  publishNamespaces(clusterId, inMemoryNamespaces);

  if (now - lastRefresh < NAMESPACE_BACKGROUND_REFRESH_INTERVAL_MS) {
    isNamespacesLoading.set(false);
    return inMemoryNamespaces;
  }

  const namespacesData = await getCache<string[]>(cacheKey);

  if (!namespacesData) return loadClusterNamespaces(clusterId);

  await setClusterNamespaces(clusterId, namespacesData);
  isNamespacesLoading.set(false);
  return namespacesData;
}

export function setSelectedNamespace(clusterId: string | null, namespace: string) {
  const available = clusterId
    ? (clusterNamespacesMap[clusterId] ?? loadedNamespaces)
    : loadedNamespaces;
  const normalized = normalizeSelection(namespace, available);
  if (clusterId) {
    namespaceSelections[clusterId] = normalized;
    persistNamespaceSelections();
  }
  selectedNamespace.set(normalized);
}

export function applyDefaultNamespace(clusterId: string, defaultNamespace: string) {
  if (namespaceSelections[clusterId]) return;
  namespaceSelections[clusterId] = defaultNamespace;
  persistNamespaceSelections();
  const available = clusterNamespacesMap[clusterId] ?? loadedNamespaces;
  const normalized = normalizeSelection(defaultNamespace, available);
  selectedNamespace.set(normalized);
}

export function setSelectedNamespaces(clusterId: string | null, namespacesSelection: string[]) {
  const available = clusterId
    ? (clusterNamespacesMap[clusterId] ?? loadedNamespaces)
    : loadedNamespaces;
  const normalized = normalizeSelection(namespacesSelection.join(","), available);
  setSelectedNamespace(clusterId, normalized);
}

export function stopNamespaceActivity(clusterId?: string | null) {
  if (clusterId) {
    bumpNamespaceRequestVersion(clusterId);
    inFlightNamespaceLoads.delete(clusterId);
    if (loadedNamespacesClusterId === clusterId) {
      isNamespacesLoading.set(false);
    }
    return;
  }

  for (const key of inFlightNamespaceLoads.keys()) {
    bumpNamespaceRequestVersion(key);
  }
  inFlightNamespaceLoads.clear();
  isNamespacesLoading.set(false);
}
