import { adaptStorageRow, type StorageRow } from "./storage-row-adapter";

type GenericItem = Record<string, unknown>;

export function createStorageRows(
  items: GenericItem[],
  workloadKey: Parameters<typeof adaptStorageRow>[1],
) {
  return items.map((item) => adaptStorageRow(item, workloadKey));
}

export function filterStorageRows(rows: StorageRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [
      row.name,
      row.namespace,
      row.kind,
      row.storageClass,
      row.phase,
      row.capacity,
      row.claim,
      row.summary,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
