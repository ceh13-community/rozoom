import type { WorkloadType } from "$shared/model/workloads";
import { invalidateWorkloadsCache } from "$features/workloads-management";

export function invalidateWorkloadSnapshotCache(
  clusterId: string | null | undefined,
  workload: WorkloadType,
) {
  if (!clusterId) return;
  invalidateWorkloadsCache({
    clusterUuid: clusterId,
    workloadType: workload,
  });
}
