import { adaptAccessControlRow, type AccessControlRow } from "./access-control-row-adapter";

type GenericItem = Record<string, unknown>;

export function createAccessControlRows(
  items: GenericItem[],
  workloadKey: Parameters<typeof adaptAccessControlRow>[1],
) {
  return items.map((item) => adaptAccessControlRow(item, workloadKey));
}

export function filterAccessControlRows(rows: AccessControlRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.namespace, row.kind, row.subjects, row.rules, row.summary]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
