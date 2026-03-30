import { getTimeDifference } from "$shared";

type GenericItem = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function summarizeStatus(status: Record<string, unknown>) {
  const phase = asString(status.phase, "");
  if (phase) return phase;
  const conditions = asArray(status.conditions);
  const ready = conditions.find((condition) => {
    const record = asRecord(condition);
    return record?.type === "Ready" || record?.type === "Available";
  });
  const readyRecord = asRecord(ready);
  if (readyRecord) {
    return `${asString(readyRecord.type)}=${asString(readyRecord.status)}`;
  }
  const state = asString(status.state, "");
  if (state) return state;
  return "Unknown";
}

export function adaptCustomResourceInstanceRow(item: GenericItem) {
  const metadata = asRecord(item.metadata) ?? {};
  const status = asRecord(item.status) ?? {};
  const createdAt = asString(metadata.creationTimestamp, "");

  return {
    uid: asString(
      metadata.uid,
      `${asString(metadata.namespace, "cluster")}/${asString(metadata.name, "unknown")}`,
    ),
    name: asString(metadata.name, "unknown"),
    namespace: asString(metadata.namespace, "cluster"),
    status: summarizeStatus(status),
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export function createCustomResourceInstanceRows(items: GenericItem[]) {
  return items.map((item) => adaptCustomResourceInstanceRow(item));
}

export type CustomResourceInstanceRow = ReturnType<typeof adaptCustomResourceInstanceRow>;
