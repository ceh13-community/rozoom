import { browser } from "$app/environment";

// Track which pressure conditions flipped True at each refresh so we can flag
// flapping nodes (repeatedly entering/leaving a pressure state) across a short
// window.

export interface PressureSnapshot {
  takenAt: string;
  // `<clusterSlug>/<nodeName>/<conditionType>` -> "True" | "False" | "-"
  states: Record<string, string>;
}

const STORAGE_KEY_PREFIX = "dashboard:nodes-pressures:snapshot:v1:";
const HISTORY_KEY_PREFIX = "dashboard:nodes-pressures:history:v1:";
const HISTORY_MAX = 5;

function storageKey(clusterSlug: string): string {
  return `${STORAGE_KEY_PREFIX}${clusterSlug}`;
}

function historyKey(clusterSlug: string): string {
  return `${HISTORY_KEY_PREFIX}${clusterSlug}`;
}

export function snapshotKey(nodeName: string, conditionType: string): string {
  return `${nodeName}/${conditionType}`;
}

export function loadLastSnapshot(clusterSlug: string): PressureSnapshot | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(storageKey(clusterSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PressureSnapshot | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSnapshot(clusterSlug: string, snapshot: PressureSnapshot) {
  if (!browser) return;
  try {
    localStorage.setItem(storageKey(clusterSlug), JSON.stringify(snapshot));
  } catch {
    // best-effort
  }
}

function loadHistory(clusterSlug: string): PressureSnapshot[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(historyKey(clusterSlug));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PressureSnapshot[] | null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushHistory(clusterSlug: string, snapshot: PressureSnapshot): PressureSnapshot[] {
  if (!browser) return [];
  try {
    const history = loadHistory(clusterSlug);
    const next = [snapshot, ...history].slice(0, HISTORY_MAX);
    localStorage.setItem(historyKey(clusterSlug), JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/**
 * A node/condition is flapping when its True/False state changed at least twice
 * within the last HISTORY_MAX snapshots.
 */
export function detectFlapping(
  clusterSlug: string,
  nodeName: string,
  conditionType: string,
): boolean {
  const history = loadHistory(clusterSlug);
  if (history.length < 3) return false;
  const key = snapshotKey(nodeName, conditionType);
  let flips = 0;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1].states[key];
    const b = history[i].states[key];
    if (a && b && a !== b) flips++;
  }
  return flips >= 2;
}
