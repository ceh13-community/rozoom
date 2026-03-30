import { getStringPodStatus } from "$entities/pod";
import { getTimeDifference } from "$shared/lib/timeFormatters";
import type { PodItem } from "$shared/model/clusters";

export type PodListRow = {
  age: string;
  ageSeconds: number;
  name: string;
  namespace: string;
  node: string;
  readyContainers: number;
  restarts: number;
  status: string;
  totalContainers: number;
  uid: string;
};

export type PodMetricsValue = {
  cpu: string;
  memory: string;
  cpuMillicores: number;
  memoryBytes: number;
};

export function getPodUid(pod: Partial<PodItem>) {
  return (
    pod.metadata?.uid ||
    `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`
  );
}

export function getPodRef(pod: Partial<PodItem>) {
  return `${pod.metadata?.namespace ?? "default"}/${pod.metadata?.name ?? "unknown"}`;
}

export function getPodMetricsKey(pod: Partial<PodItem>) {
  return `${pod.metadata?.namespace || "default"}/${pod.metadata?.name || ""}`;
}

export function getPodRestarts(pod: Partial<PodItem>) {
  return (
    pod.status?.containerStatuses?.reduce(
      (total, container) => total + container.restartCount,
      0,
    ) || 0
  );
}

export function getPodAgeSeconds(startTime: string | Date | undefined) {
  if (!startTime) return -1;
  const value = new Date(startTime).getTime();
  if (!Number.isFinite(value)) return -1;
  return Math.max(0, Math.floor((Date.now() - value) / 1000));
}

export function getPodReadySummary(pod: Partial<PodItem>) {
  const containers = pod.status?.containerStatuses ?? [];
  return {
    readyContainers: containers.filter((container) => container.ready).length,
    totalContainers: containers.length,
  };
}

export function buildPodListRow(pod: Partial<PodItem>): PodListRow {
  const ageSeconds = getPodAgeSeconds(pod.status?.startTime);
  const { readyContainers, totalContainers } = getPodReadySummary(pod);

  return {
    age: pod.status?.startTime ? getTimeDifference(pod.status.startTime) : "-",
    ageSeconds,
    name: pod.metadata?.name ?? "",
    namespace: pod.metadata?.namespace ?? "default",
    node: pod.spec?.nodeName ?? "-",
    readyContainers,
    restarts: getPodRestarts(pod),
    status: getStringPodStatus(pod as PodItem),
    totalContainers,
    uid: getPodUid(pod),
  };
}

export const buildPodRow = buildPodListRow;
