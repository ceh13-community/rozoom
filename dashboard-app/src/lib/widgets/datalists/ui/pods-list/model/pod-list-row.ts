import type { PodItem } from "$shared/model/clusters";
import { buildPodListRow, type PodListRow } from "./pod-row-adapter";

export type { PodListRow } from "./pod-row-adapter";

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
