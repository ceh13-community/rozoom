import { adaptSecretRow, type SecretRow } from "./secrets-row-adapter";

type GenericItem = Record<string, unknown>;

export function createSecretRows(items: GenericItem[]) {
  return items.map((item) => adaptSecretRow(item));
}

export function filterSecretRows(rows: SecretRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.namespace, row.type, row.signal, String(row.keys), String(row.labels)]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
