import { adaptNetworkRow } from "./network-row-adapter";

type GenericItem = Record<string, unknown>;

export type NetworkListRow = ReturnType<typeof adaptNetworkRow>;

export function createNetworkListRows(items: GenericItem[], workloadKey: string) {
  return items.map((item) => adaptNetworkRow(item, workloadKey));
}

export function filterNetworkListRows(rows: NetworkListRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.namespace, row.subtype, row.summary, row.ports]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
