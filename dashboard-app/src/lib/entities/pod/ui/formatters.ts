import type { PodItem } from "$shared/model/clusters";
import type { ContainerEnv } from "../model/pod";

export const getEnvironmentInfo = (env: ContainerEnv): string => {
  if (env.valueFrom) {
    return getValueFromInfo(env);
  }

  if (env.value) {
    return `${env.name}: ${env.value}`;
  }

  return "-";
};

const getValueFromInfo = (env: ContainerEnv): string => {
  const { valueFrom, name } = env;

  if (valueFrom?.secretKeyRef) {
    return `${name}: secret(${valueFrom.secretKeyRef.name})`;
  }

  if (valueFrom?.fieldRef) {
    return `${name}: fieldRef(${valueFrom.fieldRef.apiVersion}:{${valueFrom.fieldRef.fieldPath}})`;
  }

  return `${name}: `;
};

export function getPodStatus(
  pod: Partial<PodItem>,
): "🏃Running" | "🕰️Pending" | "😔Failed" | "💪Succeed" {
  const { status } = pod;

  if (status?.phase === "Running") return "🏃Running";

  if (status?.phase === "Succeeded") return "💪Succeed";

  if (status?.phase === "Failed") return "😔Failed";

  return "🕰️Pending";
}
