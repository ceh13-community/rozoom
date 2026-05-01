import { browser } from "$app/environment";

export interface RestartSnapshot {
  takenAt: string;
  // keyed by `<namespace>/<pod>/<container>` -> restartCount at snapshot time
  counts: Record<string, number>;
}

const STORAGE_KEY_PREFIX = "dashboard:pod-restarts:snapshot:v1:";

function storageKey(clusterId: string): string {
  return `${STORAGE_KEY_PREFIX}${clusterId}`;
}

export function loadSnapshot(clusterId: string): RestartSnapshot | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(storageKey(clusterId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RestartSnapshot | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSnapshot(clusterId: string, snapshot: RestartSnapshot) {
  if (!browser) return;
  try {
    localStorage.setItem(storageKey(clusterId), JSON.stringify(snapshot));
  } catch {
    // best-effort
  }
}

export function snapshotKey(namespace: string, pod: string, container: string): string {
  return `${namespace}/${pod}/${container}`;
}

export function deltaSince(
  snapshot: RestartSnapshot | null,
  namespace: string,
  pod: string,
  container: string,
  currentCount: number,
): number {
  if (!snapshot) return 0;
  const key = snapshotKey(namespace, pod, container);
  const prev = snapshot.counts[key];
  if (typeof prev !== "number") return 0;
  return Math.max(0, currentCount - prev);
}
