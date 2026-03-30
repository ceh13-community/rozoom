import { adaptStorageRow } from "./storage-row-adapter";

type GenericItem = Record<string, unknown>;

export function createStorageClassRows(items: GenericItem[]) {
  return items.map((item) => adaptStorageRow(item, "storageclasses"));
}

export function filterStorageClassRows(
  rows: ReturnType<typeof createStorageClassRows>,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.kind, row.phase, row.capacity, row.summary]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
