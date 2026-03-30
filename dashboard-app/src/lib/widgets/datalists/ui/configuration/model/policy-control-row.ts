import {
  adaptPolicyControlRow,
  type PolicyControlRow,
  type PolicyControlWorkloadKey,
} from "./policy-control-row-adapter";

type GenericItem = Record<string, unknown>;

export function createPolicyControlRows(
  items: GenericItem[],
  workloadKey: PolicyControlWorkloadKey,
) {
  return items.map((item) => adaptPolicyControlRow(item, workloadKey));
}

export function filterPolicyControlRows(rows: PolicyControlRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.scope, row.kind, row.signal, row.risk]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
