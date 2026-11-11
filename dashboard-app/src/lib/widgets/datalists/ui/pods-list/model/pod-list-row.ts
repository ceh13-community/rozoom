import type { PodItem } from "$shared/model/clusters";
import { buildPodListRow, type PodListRow } from "./pod-row-adapter";

export type { PodListRow } from "./pod-row-adapter";

// Grouped views (by namespace or node) render every row without pagination or
// virtualization, so they stay capped. The flat view pages and virtualizes, so
// it shows every pod.
export const GROUPED_VIEW_MAX_ROWS = 400;

export function createPodListRows(pods: Partial<PodItem>[]) {
  return pods.map((pod) => buildPodListRow(pod));
}

export function filterPodListRows(rows: PodListRow[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return rows;

  return rows.filter((row) =>
    [row.name, row.namespace, row.node, row.status].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}
