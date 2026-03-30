import { get, readable, type Readable } from "svelte/store";
import {
  selectClusterConfigurationSyncStatus,
  selectClusterCronJobsSyncStatus,
  selectClusterDaemonSetsSyncStatus,
  selectClusterDeploymentsSyncStatus,
  selectClusterJobsSyncStatus,
  selectClusterNodesHealth,
  selectClusterOverviewSyncStatus,
  selectClusterPodsSyncStatus,
  selectClusterReplicaSetsSyncStatus,
  selectClusterStatefulSetsSyncStatus,
} from "$features/check-health";
import type { WorkloadType } from "$shared/model/workloads";
import { configurationWorkloads } from "./cluster-page-workload-config";

export type ClusterSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  partialMessage?: string | null;
  lastUpdatedAt: number | null;
};

export type NodesHealthSyncStatus = {
  enabled: boolean;
  lastUpdatedAt: number | null;
  isLoading: boolean;
  error: string | null;
};

export type GenericSyncStatus = {
  enabled: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
};

export function createEmptyClusterSyncStatusStore(): Readable<ClusterSyncStatus> {
  return readable({
    enabled: false,
    isLoading: false,
    error: null,
    lastUpdatedAt: null,
  });
}

export function createEmptyNodesHealthStatusStore(): Readable<NodesHealthSyncStatus> {
  return readable({
    enabled: false,
    lastUpdatedAt: null,
    isLoading: false,
    error: null,
  });
}

export function selectWorkloadSyncStatusStore(
  clusterId: string,
  workload: WorkloadType,
): Readable<ClusterSyncStatus> | null {
  if (workload === "overview") return selectClusterOverviewSyncStatus(clusterId);
  if (workload === "pods") return selectClusterPodsSyncStatus(clusterId);
  if (workload === "deployments") return selectClusterDeploymentsSyncStatus(clusterId);
  if (workload === "daemonsets") return selectClusterDaemonSetsSyncStatus(clusterId);
  if (workload === "statefulsets") return selectClusterStatefulSetsSyncStatus(clusterId);
  if (workload === "replicasets") return selectClusterReplicaSetsSyncStatus(clusterId);
  if (workload === "jobs") return selectClusterJobsSyncStatus(clusterId);
  if (workload === "cronjobs") return selectClusterCronJobsSyncStatus(clusterId);
  if (configurationWorkloads.has(workload))
    return selectClusterConfigurationSyncStatus(clusterId, workload);
  return null;
}

export function selectNodesHealthStatusStore(
  clusterId: string,
  workload: WorkloadType,
): Readable<NodesHealthSyncStatus> {
  if (workload !== "nodesstatus") return createEmptyNodesHealthStatusStore();
  return selectClusterNodesHealth(clusterId);
}

export function readWorkloadSyncStatus(
  workload: WorkloadType,
  clusterId: string,
): GenericSyncStatus | null {
  if (!clusterId) return null;
  if (workload === "nodesstatus") return get(selectClusterNodesHealth(clusterId));
  const store = selectWorkloadSyncStatusStore(clusterId, workload);
  return store ? get(store) : null;
}

export function deriveSyncStateText(status: {
  error: string | null;
  partialMessage?: string | null;
  isLoading: boolean;
  lastUpdatedAt: number | null;
}) {
  if (status.error) return "error";
  if (status.partialMessage) return "partial";
  if (status.lastUpdatedAt) return "updated";
  if (status.isLoading) return "loading";
  return "empty";
}

export function syncBadgeTone(status: GenericSyncStatus | null): string {
  if (!status) return "text-muted-foreground";
  if (status.error) return "text-red-500";
  if (status.isLoading) return "text-amber-600 dark:text-amber-400";
  if (status.lastUpdatedAt)
    return status.enabled ? "text-green-600 dark:text-green-400" : "text-muted-foreground";
  return "text-muted-foreground";
}

export function syncBadgeText(
  status: GenericSyncStatus | null,
  formatRelative: (updatedAt: number) => string,
): string {
  if (!status) return "n/a";
  if (status.error) return "error";
  if (status.isLoading) return "updating";
  if (!status.enabled) return "off";
  if (status.lastUpdatedAt) return `updated ${formatRelative(status.lastUpdatedAt)}`;
  return "idle";
}
