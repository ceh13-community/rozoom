import { getTimeDifference } from "$shared";
import type { WorkloadType } from "$shared/model/workloads";
import { renderConfigurationSummary } from "../../configuration-list/model/resource-renderers";

type GenericItem = Record<string, unknown>;

type StorageWorkloadKey = "persistentvolumeclaims" | "persistentvolumes" | "storageclasses";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getMetadata(item: GenericItem) {
  return asRecord(item.metadata) ?? {};
}

function getSpec(item: GenericItem) {
  return asRecord(item.spec) ?? {};
}

function getStatus(item: GenericItem) {
  return asRecord(item.status) ?? {};
}

function getKind(workloadKey: StorageWorkloadKey) {
  const kinds: Record<StorageWorkloadKey, string> = {
    persistentvolumeclaims: "PersistentVolumeClaim",
    persistentvolumes: "PersistentVolume",
    storageclasses: "StorageClass",
  };
  return kinds[workloadKey];
}

export function adaptStorageRow(item: GenericItem, workloadKey: StorageWorkloadKey) {
  const metadata = getMetadata(item);
  const spec = getSpec(item);
  const status = getStatus(item);
  const createdAt = asString(metadata.creationTimestamp, "");
  const summary = renderConfigurationSummary(workloadKey as WorkloadType, item);

  const storageClass =
    workloadKey === "storageclasses" ? asString(metadata.name) : asString(spec.storageClassName);
  const phase = asString(status.phase, workloadKey === "storageclasses" ? "Active" : "-");
  const capacity =
    workloadKey === "persistentvolumeclaims"
      ? asString(asRecord(asRecord(spec.resources)?.requests)?.storage)
      : workloadKey === "persistentvolumes"
        ? asString(asRecord(spec.capacity)?.storage)
        : asString(item.volumeBindingMode);
  const claim =
    workloadKey === "persistentvolumes"
      ? `${asString(asRecord(spec.claimRef)?.namespace)}/${asString(asRecord(spec.claimRef)?.name)}`
      : "-";

  return {
    uid: asString(
      metadata.uid,
      `${asString(metadata.namespace, "cluster")}/${asString(metadata.name, "unknown")}`,
    ),
    name: asString(metadata.name, "unknown"),
    namespace: asString(
      metadata.namespace,
      workloadKey === "storageclasses" ? "cluster" : "default",
    ),
    kind: getKind(workloadKey),
    storageClass,
    phase,
    capacity,
    claim,
    summary: summary.details,
    problemScore: summary.scoreDelta,
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export type StorageRow = ReturnType<typeof adaptStorageRow>;
