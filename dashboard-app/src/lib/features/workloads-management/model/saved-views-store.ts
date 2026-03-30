import type { WorkloadType } from "$shared/model/workloads";

export type SavedView = {
  id: string;
  name: string;
  workload: WorkloadType;
  clusterId: string;
  query: string;
  columns: string[];
  sortBy: string;
  sortDirection: "asc" | "desc";
  updatedAt: number;
};

const STORAGE_KEY = "dashboard.workloads.saved-views.v1";

function isSavedView(value: unknown): value is SavedView {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.workload === "string" &&
    typeof item.clusterId === "string" &&
    typeof item.query === "string" &&
    Array.isArray(item.columns) &&
    item.columns.every((entry) => typeof entry === "string") &&
    typeof item.sortBy === "string" &&
    (item.sortDirection === "asc" || item.sortDirection === "desc") &&
    typeof item.updatedAt === "number"
  );
}

function loadRaw(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedView) : [];
  } catch {
    return [];
  }
}

function saveRaw(next: SavedView[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function listSavedViews(): SavedView[] {
  return loadRaw().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function upsertSavedView(input: Omit<SavedView, "updatedAt">): SavedView {
  const all = loadRaw();
  const next: SavedView = { ...input, updatedAt: Date.now() };
  const merged = [...all.filter((item) => item.id !== input.id), next];
  saveRaw(merged);
  return next;
}

export function deleteSavedView(id: string) {
  const all = loadRaw();
  saveRaw(all.filter((item) => item.id !== id));
}
