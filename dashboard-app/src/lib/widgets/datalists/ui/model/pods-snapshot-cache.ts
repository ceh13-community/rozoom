import type { PodItem } from "$shared/model/clusters";
import { getIndexedCache, putIndexedCacheWithPrefixLimit } from "$shared/lib/indexeddb-cache";

type PodsSnapshot = {
  schemaVersion: 1;
  scopeKey: string;
  cachedAt: number;
  pods: Partial<PodItem>[];
};

const PODS_SNAPSHOT_STORAGE_PREFIX = "dashboard.pods.snapshot.v1";
const PODS_SNAPSHOT_INDEXED_PREFIX = "dashboard.pods.snapshot.idb.v1:";
const PODS_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const PODS_SNAPSHOT_MAX_ENTRIES = 12;
const PODS_SNAPSHOT_MAX_ITEMS = 2000;
const podsSnapshotsMemory = new Map<string, PodsSnapshot>();

function normalizeSegment(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function normalizeNamespaces(selectedNamespaces: string[] | null): string {
  if (selectedNamespaces === null) return "all";
  if (!Array.isArray(selectedNamespaces) || selectedNamespaces.length === 0) return "none";
  return [...new Set(selectedNamespaces.map((item) => item.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join(",");
}

function getSnapshotStorageKey(scopeKey: string) {
  return `${PODS_SNAPSHOT_STORAGE_PREFIX}:${encodeURIComponent(scopeKey)}`;
}

function getSnapshotIndexedKey(scopeKey: string) {
  return `${PODS_SNAPSHOT_INDEXED_PREFIX}${encodeURIComponent(scopeKey)}`;
}

function compactPodForSnapshot(pod: Partial<PodItem>): Partial<PodItem> {
  const ownerKinds =
    pod.metadata?.ownerReferences
      ?.map((item) => ({ kind: item.kind }))
      .filter((item) => Boolean(item.kind)) ?? [];
  const containerStatuses =
    pod.status?.containerStatuses?.map((item) => ({
      ready: item.ready,
      restartCount: item.restartCount,
    })) ?? [];
  return {
    metadata: {
      uid: pod.metadata?.uid,
      name: pod.metadata?.name,
      namespace: pod.metadata?.namespace,
      ownerReferences: ownerKinds,
    },
    status: {
      startTime: pod.status?.startTime,
      qosClass: pod.status?.qosClass,
      phase: pod.status?.phase,
      containerStatuses,
    },
    spec: {
      nodeName: pod.spec?.nodeName,
    },
  } as Partial<PodItem>;
}

function compactPodsForSnapshot(pods: Partial<PodItem>[]) {
  return pods.slice(0, PODS_SNAPSHOT_MAX_ITEMS).map((pod) => compactPodForSnapshot(pod));
}

function parsePodsSnapshot(raw: string | null): PodsSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PodsSnapshot>;
    if (parsed.schemaVersion !== 1) return null;
    if (typeof parsed.scopeKey !== "string" || parsed.scopeKey.length === 0) return null;
    const cachedAt = parsed.cachedAt;
    if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt)) return null;
    if (Date.now() - cachedAt > PODS_SNAPSHOT_TTL_MS) return null;
    if (!Array.isArray(parsed.pods)) return null;
    return {
      schemaVersion: 1,
      scopeKey: parsed.scopeKey,
      cachedAt,
      pods: parsed.pods,
    };
  } catch {
    return null;
  }
}

function cleanupPersistedSnapshots() {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (key.startsWith(`${PODS_SNAPSHOT_STORAGE_PREFIX}:`)) {
      keys.push(key);
    }
  }
  if (keys.length === 0) return;
  const entries: Array<{ key: string; cachedAt: number }> = [];
  for (const key of keys) {
    const parsed = parsePodsSnapshot(window.localStorage.getItem(key));
    if (!parsed) {
      window.localStorage.removeItem(key);
      continue;
    }
    entries.push({ key, cachedAt: parsed.cachedAt });
  }
  if (entries.length <= PODS_SNAPSHOT_MAX_ENTRIES) return;
  entries.sort((left, right) => right.cachedAt - left.cachedAt);
  for (const stale of entries.slice(PODS_SNAPSHOT_MAX_ENTRIES)) {
    window.localStorage.removeItem(stale.key);
  }
}

export function buildPodsSnapshotScopeKey(clusterId: string, selectedNamespaces: string[] | null) {
  const cluster = normalizeSegment(clusterId, "unknown-cluster");
  const namespaces = normalizeNamespaces(selectedNamespaces);
  return `${cluster}::${namespaces}`;
}

export function loadPersistedPodsSnapshot(scopeKey: string): PodsSnapshot | null {
  if (!scopeKey) return null;
  const inMemory = podsSnapshotsMemory.get(scopeKey);
  if (inMemory && Date.now() - inMemory.cachedAt <= PODS_SNAPSHOT_TTL_MS) {
    return inMemory;
  }
  if (typeof window === "undefined") return null;
  try {
    const parsed = parsePodsSnapshot(window.localStorage.getItem(getSnapshotStorageKey(scopeKey)));
    if (parsed && parsed.scopeKey === scopeKey) {
      podsSnapshotsMemory.set(scopeKey, parsed);
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function persistPodsSnapshot(scopeKey: string, pods: Partial<PodItem>[]) {
  if (!scopeKey) return;
  const snapshot: PodsSnapshot = {
    schemaVersion: 1,
    scopeKey,
    cachedAt: Date.now(),
    pods: Array.isArray(pods) ? compactPodsForSnapshot(pods) : [],
  };
  podsSnapshotsMemory.set(scopeKey, snapshot);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getSnapshotStorageKey(scopeKey), JSON.stringify(snapshot));
    cleanupPersistedSnapshots();
  } catch {
    // Ignore storage failures.
  }
}

export async function loadPersistedPodsSnapshotAsync(
  scopeKey: string,
): Promise<PodsSnapshot | null> {
  if (!scopeKey) return null;
  const inMemory = podsSnapshotsMemory.get(scopeKey);
  if (inMemory && Date.now() - inMemory.cachedAt <= PODS_SNAPSHOT_TTL_MS) {
    return inMemory;
  }
  try {
    const cached = await getIndexedCache<PodsSnapshot>(getSnapshotIndexedKey(scopeKey));
    const serialized = cached ? JSON.stringify(cached) : null;
    const parsed = parsePodsSnapshot(serialized);
    if (!parsed || parsed.scopeKey !== scopeKey) return null;
    podsSnapshotsMemory.set(scopeKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function persistPodsSnapshotAsync(scopeKey: string, pods: Partial<PodItem>[]) {
  if (!scopeKey) return;
  const snapshot: PodsSnapshot = {
    schemaVersion: 1,
    scopeKey,
    cachedAt: Date.now(),
    pods: Array.isArray(pods) ? compactPodsForSnapshot(pods) : [],
  };
  podsSnapshotsMemory.set(scopeKey, snapshot);
  try {
    await putIndexedCacheWithPrefixLimit(getSnapshotIndexedKey(scopeKey), snapshot, {
      prefix: PODS_SNAPSHOT_INDEXED_PREFIX,
      maxEntries: PODS_SNAPSHOT_MAX_ENTRIES,
    });
  } catch {
    // Ignore IndexedDB failures.
  }
}

export function clearPodsSnapshotCacheForTests() {
  podsSnapshotsMemory.clear();
}
