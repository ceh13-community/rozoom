<script lang="ts">
  import {
    getContainerReason,
    getContainerStatus,
    getLastHealthCheck,
  } from "$features/check-health";
  import DataTable from "./data-table.svelte";
  import { columns, type PodRestartsData } from "./columns";
  import { onMount } from "svelte";
  import type { ClusterHealthChecks } from "$features/check-health";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface PodsRestartsListProps {
    data: { uuid: string };
  }

  const { data }: PodsRestartsListProps = $props();
  let latestCheck: ClusterHealthChecks | null = $state(null);
  let allPodData: PodRestartsData[] = $state([]);
  let loading = $state(true);

  async function refreshPodRestartsData() {
    const clusterId = data.uuid;
    if (!clusterId) return;
    const nextCheck = await getLastHealthCheck(clusterId);
    if (!nextCheck || "errors" in nextCheck) {
      latestCheck = null;
      allPodData = [];
      return;
    }
    latestCheck = nextCheck;

    allPodData = latestCheck.podRestarts
      .flatMap((podRestartObj) => {
        const result: PodRestartsData[] = [];
        const podName = podRestartObj.pod;

        if (Array.isArray(podRestartObj.containers)) {
          podRestartObj.containers
            .filter((containerData) => containerData.restartCount > 0)
            .forEach((containerData) => {
              result.push({
                namespace: podRestartObj.namespace,
                pod: podName,
                container: containerData.containerName,
                restarts: containerData.restartCount,
                delta10m: 0,
                reason: getContainerReason(containerData),
                status: getContainerStatus(containerData),
                age: containerData.lastState?.running?.startedAt || containerData.startedAt || "-",
              });
            });
        }

        return result;
      })
      .sort((a, b) => b.restarts - a.restarts);
  }

  onMount(async () => {
    await refreshPodRestartsData();
    loading = false;
  });
</script>

{#if loading}
  <div class="px-4 py-6 text-sm text-muted-foreground">Loading pod restarts<LoadingDots /></div>
{:else if allPodData.length > 0}
  <DataTable data={allPodData} {columns} />
{:else}
  <TableEmptyState message="No pod restarts found." />
{/if}
