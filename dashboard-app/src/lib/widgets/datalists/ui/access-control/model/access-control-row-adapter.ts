import { getTimeDifference } from "$shared";
import type { WorkloadType } from "$shared/model/workloads";
import { renderConfigurationSummary } from "../../configuration-list/model/resource-renderers";

type GenericItem = Record<string, unknown>;

type AccessControlWorkloadKey =
  | "serviceaccounts"
  | "roles"
  | "rolebindings"
  | "clusterroles"
  | "clusterrolebindings";

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

function getKind(workloadKey: AccessControlWorkloadKey) {
  const kinds: Record<AccessControlWorkloadKey, string> = {
    serviceaccounts: "ServiceAccount",
    roles: "Role",
    rolebindings: "RoleBinding",
    clusterroles: "ClusterRole",
    clusterrolebindings: "ClusterRoleBinding",
  };
  return kinds[workloadKey];
}

function getSubjectsSummary(item: GenericItem, workloadKey: AccessControlWorkloadKey) {
  if (workloadKey !== "rolebindings" && workloadKey !== "clusterrolebindings") return "-";
  const roleRef = asRecord(item.roleRef) ?? {};
  const subjects = asArray(item.subjects);
  return `${subjects.length} -> ${asString(roleRef.kind, "Role")}/${asString(roleRef.name)}`;
}

function getRulesSummary(item: GenericItem, workloadKey: AccessControlWorkloadKey) {
  if (workloadKey !== "roles" && workloadKey !== "clusterroles") return "-";
  return String(asArray(item.rules).length);
}

export function adaptAccessControlRow(item: GenericItem, workloadKey: AccessControlWorkloadKey) {
  const metadata = getMetadata(item);
  const createdAt = asString(metadata.creationTimestamp, "");
  const summary = renderConfigurationSummary(workloadKey as WorkloadType, item);

  return {
    uid: asString(
      metadata.uid,
      `${asString(metadata.namespace, "cluster")}/${asString(metadata.name, "unknown")}`,
    ),
    name: asString(metadata.name, "unknown"),
    namespace: asString(
      metadata.namespace,
      workloadKey === "clusterroles" || workloadKey === "clusterrolebindings"
        ? "cluster"
        : "default",
    ),
    kind: getKind(workloadKey),
    subjects: getSubjectsSummary(item, workloadKey),
    rules: getRulesSummary(item, workloadKey),
    summary: summary.details,
    problemScore: summary.scoreDelta,
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export type AccessControlRow = ReturnType<typeof adaptAccessControlRow>;
