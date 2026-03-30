import { readJsonFromStorage, writeJsonToStorage } from "./local-storage";

type RecentClusterEntry = {
  clusterId: string;
  visitedAt: number;
};

type PersistedRecentClusterEntries = {
  entries: RecentClusterEntry[];
};

const RECENT_CLUSTER_STORAGE_KEY = "dashboard.cluster.runtime-recent.v1";
const MAX_RECENT_CLUSTER_ENTRIES = 24;

function isRecentClusterEntry(value: unknown): value is RecentClusterEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as RecentClusterEntry).clusterId === "string" &&
      typeof (value as RecentClusterEntry).visitedAt === "number",
  );
}

function isPersistedRecentClusterEntries(value: unknown): value is PersistedRecentClusterEntries {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as PersistedRecentClusterEntries).entries) &&
      (value as PersistedRecentClusterEntries).entries.every(isRecentClusterEntry),
  );
}

function loadRecentClusterEntries() {
  const persisted = readJsonFromStorage<PersistedRecentClusterEntries>(RECENT_CLUSTER_STORAGE_KEY, {
    fallback: { entries: [] },
    validate: isPersistedRecentClusterEntries,
  });

  return persisted.entries
    .filter((entry) => entry.clusterId.trim().length > 0)
    .sort((a, b) => b.visitedAt - a.visitedAt);
}

function persistRecentClusterEntries(entries: RecentClusterEntry[]) {
  writeJsonToStorage(RECENT_CLUSTER_STORAGE_KEY, {
    entries: entries.slice(0, MAX_RECENT_CLUSTER_ENTRIES),
  });
}

export function markRecentCluster(clusterId: string, visitedAt = Date.now()) {
  const normalizedClusterId = clusterId.trim();
  if (!normalizedClusterId) return;

  const next = loadRecentClusterEntries().filter(
    (entry) => entry.clusterId !== normalizedClusterId,
  );
  next.unshift({ clusterId: normalizedClusterId, visitedAt });
  persistRecentClusterEntries(next);
}

export function listRecentClusters(limit = MAX_RECENT_CLUSTER_ENTRIES) {
  return loadRecentClusterEntries()
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.clusterId);
}

export function resolveWarmClusterCandidates(options: {
  activeClusterId: string | null;
  pinnedClusterIds: string[];
  maxWarmClusters: number;
}) {
  const activeClusterId = options.activeClusterId?.trim() || null;
  const limit = Math.max(0, options.maxWarmClusters);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const candidate of [...options.pinnedClusterIds, ...listRecentClusters()]) {
    const normalized = candidate.trim();
    if (!normalized || normalized === activeClusterId || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
    if (ordered.length >= limit) break;
  }

  return ordered;
}

export function resetRecentClusters() {
  persistRecentClusterEntries([]);
}
