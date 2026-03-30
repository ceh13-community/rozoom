import {
  adaptConfigurationCoreRow,
  type ConfigurationCoreRow,
} from "./configuration-core-row-adapter";

type GenericItem = Record<string, unknown>;

export function createConfigurationCoreRows(
  items: GenericItem[],
  workloadKey: Parameters<typeof adaptConfigurationCoreRow>[1],
) {
  return items.map((item) => adaptConfigurationCoreRow(item, workloadKey));
}

export function filterConfigurationCoreRows(rows: ConfigurationCoreRow[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;

  return rows.filter((row) =>
    [row.name, row.namespace, row.kind, row.summary].join(" ").toLowerCase().includes(normalized),
  );
}
