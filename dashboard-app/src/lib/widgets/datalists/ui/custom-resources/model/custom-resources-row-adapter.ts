import { getTimeDifference } from "$shared";
import type { WorkloadType } from "$shared/model/workloads";
import { renderConfigurationSummary } from "../../configuration-list/model/resource-renderers";

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

function getMetadata(item: GenericItem) {
  return asRecord(item.metadata) ?? {};
}

export function adaptCustomResourceRow(item: GenericItem) {
  const metadata = getMetadata(item);
  const spec = asRecord(item.spec) ?? {};
  const status = asRecord(item.status) ?? {};
  const names = asRecord(spec.names) ?? {};
  const versions = asArray(spec.versions).map((entry) => asRecord(entry));
  const storageVersion =
    versions.find((entry) => entry?.storage === true)?.name ??
    versions[0]?.name ??
    asArray(status.storedVersions)[0];
  const createdAt = asString(metadata.creationTimestamp, "");
  const summary = renderConfigurationSummary("customresourcedefinitions" as WorkloadType, item);

  return {
    uid: asString(metadata.uid, `cluster/${asString(metadata.name, "unknown")}`),
    name: asString(metadata.name, "unknown"),
    group: asString(spec.group),
    version: asString(storageVersion),
    scope: asString(spec.scope),
    resource: asString(names.plural),
    summary: summary.details,
    problemScore: summary.scoreDelta,
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export type CustomResourceRow = ReturnType<typeof adaptCustomResourceRow>;
