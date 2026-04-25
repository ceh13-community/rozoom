import { browser } from "$app/environment";
import { writable, get } from "svelte/store";

export interface ScanHistoryEntry {
  ranAt: string;
  provider: "kubescape" | "kube-bench";
  score: number;
  totalFail: number;
  totalWarn: number;
  totalPass: number;
  totalFindings: number;
}

const STORAGE_KEY = "dashboard:compliance-hub:history:v1";
const MAX_ENTRIES_PER_CLUSTER = 10;

function load(): Record<string, ScanHistoryEntry[]> {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ScanHistoryEntry[]> | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(value: Record<string, ScanHistoryEntry[]>) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

export const complianceHistory = writable<Record<string, ScanHistoryEntry[]>>(load());

if (browser) {
  complianceHistory.subscribe((value) => {
    persist(value);
  });
}

export function appendHistory(clusterId: string, entry: ScanHistoryEntry) {
  complianceHistory.update((current) => {
    const existing = current[clusterId] ?? [];
    const next = [entry, ...existing].slice(0, MAX_ENTRIES_PER_CLUSTER);
    return { ...current, [clusterId]: next };
  });
}

export function getLatestForProvider(
  clusterId: string,
  provider: ScanHistoryEntry["provider"],
): ScanHistoryEntry | null {
  const list = get(complianceHistory)[clusterId] ?? [];
  return list.find((entry) => entry.provider === provider) ?? null;
}

export function computeScore(totals: { pass: number; fail: number; warn: number }): number {
  const total = totals.pass + totals.fail + totals.warn;
  if (total === 0) return 0;
  // FAIL=0 points, WARN=0.5, PASS=1
  const weighted = totals.pass + totals.warn * 0.5;
  return Math.round((weighted / total) * 100);
}
