import { error as logError } from "@tauri-apps/plugin-log";
import type { WorkloadType } from "$shared/model/workloads";
import { useWorkloadsFetcher } from "./workloads-fetcher.svelte";

const DEFAULT_WORKLOAD_TYPE: WorkloadType = "overview";

interface WorkloadsParams {
  clusterUuid: string;
  sortField?: string;
  namespace: string;
  workloadType: WorkloadType;
}

interface CreateWorkloadsStoreOptions {
  clusterUuid: string;
  sortField?: string;
  namespace?: string;
  initialWorkloadType?: WorkloadType;
}

export function createWorkloadsStore({
  clusterUuid,
  sortField,
  namespace = "all",
  initialWorkloadType = DEFAULT_WORKLOAD_TYPE,
}: CreateWorkloadsStoreOptions) {
  const fetcher = useWorkloadsFetcher();

  const params = $state<WorkloadsParams>({
    clusterUuid,
    sortField,
    namespace,
    workloadType: initialWorkloadType,
  });

  $effect(() => {
    const { clusterUuid, namespace, workloadType, sortField } = params;
    if (!clusterUuid) return;

    fetcher
      .fetchWorkloads(workloadType, namespace, clusterUuid, sortField)
      .catch(async (err: unknown) => {
        const message = `Failed to fetch workloads: ${(err as Error).message}`;
        await logError(message);
      });
  });

  function updateParams(next: Partial<WorkloadsParams>) {
    let changed = false;

    for (const key in next) {
      const k = key as keyof WorkloadsParams;
      if (next[k] !== undefined && params[k] !== next[k]) {
        params[k] = next[k] as never;
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Drops the data and forgets which data it was. Without forgetting, the next
   * updateParams with the same params changes nothing, so nothing loads and the
   * view gets no data: a split pane closed and opened again on the same workload
   * showed "No data provided".
   */
  function reset() {
    fetcher.reset();
    params.clusterUuid = "";
  }

  /** Loads the current params again, past the cache: used when a cluster answers again. */
  function refetch() {
    const { clusterUuid, namespace, workloadType, sortField } = params;
    if (!clusterUuid) return;
    fetcher
      .fetchWorkloads(workloadType, namespace, clusterUuid, sortField, true)
      .catch(async (err: unknown) => {
        await logError(`Failed to fetch workloads: ${(err as Error).message}`);
      });
  }

  return {
    get data() {
      return fetcher.data;
    },
    get isLoading() {
      return fetcher.isLoading;
    },
    get error() {
      return fetcher.error;
    },
    get cache() {
      return fetcher.cache;
    },
    get params() {
      return params;
    },

    updateParams,
    reset,
    refetch,
  };
}
