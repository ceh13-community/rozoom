import { getTimeDifference } from "$shared";
import type { WorkloadType } from "$shared/model/workloads";
import { renderConfigurationSummary } from "../../configuration-list/model/resource-renderers";

type GenericItem = Record<string, unknown>;

type ConfigurationCoreWorkloadKey = "configmaps" | "resourcequotas" | "limitranges" | "leases";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getMetadata(item: GenericItem) {
  return asRecord(item.metadata) ?? {};
}

function getKind(workloadKey: ConfigurationCoreWorkloadKey, item: GenericItem) {
  const kind = asString(item.kind, "");
  if (kind !== "") return kind;
  const fallbackByWorkload: Record<ConfigurationCoreWorkloadKey, string> = {
    configmaps: "ConfigMap",
    resourcequotas: "ResourceQuota",
    limitranges: "LimitRange",
    leases: "Lease",
  };
  return fallbackByWorkload[workloadKey];
}

export function adaptConfigurationCoreRow(
  item: GenericItem,
  workloadKey: ConfigurationCoreWorkloadKey,
) {
  const metadata = getMetadata(item);
  const createdAt = asString(metadata.creationTimestamp, "");
  const summary = renderConfigurationSummary(workloadKey as WorkloadType, item);

  return {
    uid: asString(
      metadata.uid,
      `${asString(metadata.namespace, "cluster")}/${asString(metadata.name, "unknown")}`,
    ),
    name: asString(metadata.name, "unknown"),
    namespace: asString(metadata.namespace, "cluster"),
    kind: getKind(workloadKey, item),
    summary: summary.details,
    problemScore: summary.scoreDelta,
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export type ConfigurationCoreRow = ReturnType<typeof adaptConfigurationCoreRow>;
