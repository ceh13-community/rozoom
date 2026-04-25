import { browser } from "$app/environment";
import { writable } from "svelte/store";

export interface TrivyHistoryEntry {
  ranAt: string;
  totalVulns: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  fixable: number;
  misconfigs: number;
  exposedSecrets: number;
}

const STORAGE_KEY = "dashboard:trivy-hub:history:v1";
const MAX_ENTRIES_PER_CLUSTER = 10;

function load(): Record<string, TrivyHistoryEntry[]> {
  if (!browser) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TrivyHistoryEntry[]> | null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(value: Record<string, TrivyHistoryEntry[]>) {
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best-effort
  }
}

export const trivyHistory = writable<Record<string, TrivyHistoryEntry[]>>(load());

if (browser) {
  trivyHistory.subscribe((value) => {
    persist(value);
  });
}

export function appendHistory(clusterId: string, entry: TrivyHistoryEntry) {
  trivyHistory.update((current) => {
    const existing = current[clusterId] ?? [];
    const next = [entry, ...existing].slice(0, MAX_ENTRIES_PER_CLUSTER);
    return { ...current, [clusterId]: next };
  });
}
