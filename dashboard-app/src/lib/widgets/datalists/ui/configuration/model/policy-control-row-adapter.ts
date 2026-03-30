import { getTimeDifference } from "$shared";
import type { WorkloadType } from "$shared/model/workloads";
import { renderConfigurationSummary } from "../../configuration-list/model/resource-renderers";

type GenericItem = Record<string, unknown>;

export type PolicyControlWorkloadKey =
  | "horizontalpodautoscalers"
  | "poddisruptionbudgets"
  | "priorityclasses"
  | "runtimeclasses"
  | "mutatingwebhookconfigurations"
  | "validatingwebhookconfigurations";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getMetadata(item: GenericItem) {
  return asRecord(item.metadata) ?? {};
}

function getKind(workloadKey: PolicyControlWorkloadKey, item: GenericItem) {
  const kind = asString(item.kind, "");
  if (kind !== "") return kind;

  const fallbackByWorkload: Record<PolicyControlWorkloadKey, string> = {
    horizontalpodautoscalers: "HorizontalPodAutoscaler",
    poddisruptionbudgets: "PodDisruptionBudget",
    priorityclasses: "PriorityClass",
    runtimeclasses: "RuntimeClass",
    mutatingwebhookconfigurations: "MutatingWebhookConfiguration",
    validatingwebhookconfigurations: "ValidatingWebhookConfiguration",
  };

  return fallbackByWorkload[workloadKey];
}

function getScope(workloadKey: PolicyControlWorkloadKey, metadata: Record<string, unknown>) {
  if (
    workloadKey === "priorityclasses" ||
    workloadKey === "runtimeclasses" ||
    workloadKey === "mutatingwebhookconfigurations" ||
    workloadKey === "validatingwebhookconfigurations"
  ) {
    return "cluster";
  }
  return asString(metadata.namespace, "cluster");
}

function getRiskLabel(score: number) {
  if (score >= 200) return "high";
  if (score >= 100) return "medium";
  return "normal";
}

export function adaptPolicyControlRow(item: GenericItem, workloadKey: PolicyControlWorkloadKey) {
  const metadata = getMetadata(item);
  const createdAt = asString(metadata.creationTimestamp, "");
  const summary = renderConfigurationSummary(workloadKey as WorkloadType, item);

  return {
    uid: asString(
      metadata.uid,
      `${getScope(workloadKey, metadata)}/${asString(metadata.name, "unknown")}`,
    ),
    name: asString(metadata.name, "unknown"),
    scope: getScope(workloadKey, metadata),
    kind: getKind(workloadKey, item),
    signal: summary.details,
    risk: getRiskLabel(summary.scoreDelta),
    age: createdAt ? getTimeDifference(new Date(createdAt)) : "-",
    raw: item,
  };
}

export type PolicyControlRow = ReturnType<typeof adaptPolicyControlRow>;
