import { adaptCustomResourceRow, type CustomResourceRow } from "./custom-resources-row-adapter";

type GenericItem = Record<string, unknown>;

export function createCustomResourceRows(items: GenericItem[]) {
  return items.map((item) => adaptCustomResourceRow(item));
}

export function filterCustomResourceRows(rows: CustomResourceRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.group, row.version, row.scope, row.resource, row.summary]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
