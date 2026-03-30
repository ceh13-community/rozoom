import { adaptStorageRow } from "./storage-row-adapter";

type GenericItem = Record<string, unknown>;

export function createPersistentVolumeRows(items: GenericItem[]) {
  return items.map((item) => adaptStorageRow(item, "persistentvolumes"));
}

export function filterPersistentVolumeRows(
  rows: ReturnType<typeof createPersistentVolumeRows>,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.storageClass, row.claim, row.phase, row.capacity, row.summary]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
