<script lang="ts">
  import { onMount } from "svelte";
  import { timeAgo, type NodeItem } from "$shared";
  import { Button } from "$shared/ui/button";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import {
    getLastHealthCheck,
    type ClusterHealthChecks,
    initWatchParsers,
  } from "$features/check-health";
  import { columns, type NodesPressuresData } from "./columns";
  import DataTable from "./data-table.svelte";
  import type { PageData } from "$entities/cluster";

  interface NodesPressuresListProps {
    data: PageData & { nodes?: NodeItem[] };
  }

  const { data }: NodesPressuresListProps = $props();
  let latestCheck: ClusterHealthChecks | null = $state(null);
  let allNodeData: NodesPressuresData[] = $state([]);
  let loading = $state(true);

  async function refreshNodePressures() {
    const nextCheck = await getLastHealthCheck(data.slug);
    latestCheck = nextCheck && !("errors" in nextCheck) ? nextCheck : null;
  }

  onMount(async () => {
    initWatchParsers();
    await refreshNodePressures();
    loading = false;
  });

  $effect(() => {
    if (!latestCheck || !latestCheck.nodes) {
      return;
    }

    allNodeData = latestCheck.nodes.checks.map((node) => ({
      age: timeAgo(new Date(node.metadata.creationTimestamp)),
      diskPressure: node.status.conditions?.find((c) => c.type === "DiskPressure")?.status || "-",
      memoryPressure:
        node.status.conditions?.find((c) => c.type === "MemoryPressure")?.status || "-",
      name: node.metadata.name,
      networkUnavailable:
        node.status.conditions?.find((c) => c.type === "NetworkUnavailable")?.status || "-",
      pidPressure: node.status.conditions?.find((c) => c.type === "PIDPressure")?.status || "-",
      ready: node.status.conditions?.find((c) => c.type === "Ready")?.status || "-",
      role: node.role || "-",
      uid: node.metadata.name,
    }));
  });
</script>

<div class="mb-3 flex justify-end">
  <Button variant="outline" size="sm" onclick={refreshNodePressures} loading={loading} loadingLabel="Refreshing">Refresh</Button>
</div>

{#if loading}
  <div class="px-4 py-6 text-sm text-muted-foreground">Loading node pressures<LoadingDots /></div>
{:else if allNodeData.length > 0}
  <DataTable data={allNodeData} {columns} />
{:else}
  <TableEmptyState message="No node pressure conditions found." />
{/if}
