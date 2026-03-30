import { getDeploymentStatus } from "$entities/deployment/ui/formatters";
import { buildDeploymentProblemScore } from "../../model/problem-priority";

type DeploymentInput = {
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string | Date;
  };
  spec?: {
    replicas?: number;
    template?: {
      spec?: {
        nodeName?: string;
        nodeSelector?: Record<string, string>;
        [key: string]: unknown;
      };
    };
  };
  status?: {
    readyReplicas?: number;
    replicas?: number;
    availableReplicas?: number;
  };
};

export type DeploymentRowLike = {
  uid: string;
  name: string;
  namespace: string;
  ready: string;
  upToDate: number;
  available: number;
  node: string;
  replicas: number;
  age: string;
  ageSeconds: number;
  status: string;
  problemScore: number;
};

function toAgeLabel(ageSeconds: number) {
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h`;
  return `${Math.floor(ageSeconds / 86400)}d`;
}

export function mapDeploymentRows(source: DeploymentInput[]): DeploymentRowLike[] {
  return source.map((deployment) => {
    const name = deployment.metadata?.name ?? "-";
    const namespace = deployment.metadata?.namespace ?? "default";
    const replicas = deployment.spec?.replicas ?? 0;
    const ready = deployment.status?.readyReplicas ?? 0;
    const upToDate = deployment.status?.replicas ?? 0;
    const available = deployment.status?.availableReplicas ?? 0;
    const templateSpec = deployment.spec?.template?.spec;
    const nodeFromSelector = Object.entries(templateSpec?.nodeSelector ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    const node = templateSpec?.nodeName || nodeFromSelector || "-";
    const createdAt = deployment.metadata?.creationTimestamp;
    const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
    const ageSeconds = Number.isFinite(createdMs)
      ? Math.max(0, Math.floor((Date.now() - createdMs) / 1000))
      : 0;
    const status = getDeploymentStatus(deployment as never);

    return {
      uid: `${namespace}/${name}`,
      name,
      namespace,
      ready: `${ready}/${replicas}`,
      upToDate,
      available,
      node,
      replicas,
      age: toAgeLabel(ageSeconds),
      ageSeconds,
      status,
      problemScore: buildDeploymentProblemScore({
        replicas,
        ready,
        upToDate,
        available,
        status,
      }),
    };
  });
}
