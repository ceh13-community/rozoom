<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkNodeUtilization, updateClusterCheckPartially } from "$features/check-health";
  import type { NodeUtilizationReport } from "$features/check-health/model/types";

  interface Props {
    report: NodeUtilizationReport | null;
    clusterId: string;
  }

  const { report, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const summary = $derived(report?.summary ?? null);
  const nodes = $derived(report?.nodes ?? []);
  const updatedAtText = $derived.by(() =>
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  const badgeLabel = $derived.by(() => {
    if (!summary || summary.nodeCount === 0) return "Unknown";
    return `CPU ${summary.avgCpuPercent}% / Mem ${summary.avgMemoryPercent}%`;
  });

  const statusClass = $derived.by(() => {
    if (!report) return STATUS_CLASSES.unknown;
    if (report.status === "ok") return STATUS_CLASSES.ok;
    if (report.status === "warning") return STATUS_CLASSES.warning;
    if (report.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkNodeUtilization(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { nodeUtilization: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Node load:</span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {badgeLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[580px] max-h-[520px] overflow-y-auto" sideOffset={8}>
      <p>Node load: {badgeLabel}</p>
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Refresh now
        </Button>
      </div>

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Node</Table.Head>
            <Table.Head>CPU (cores)</Table.Head>
            <Table.Head>CPU %</Table.Head>
            <Table.Head>Memory</Table.Head>
            <Table.Head>Memory %</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if nodes.length}
            {#each nodes as node (node.name)}
              <Table.Row>
                <Table.Cell>{node.name}</Table.Cell>
                <Table.Cell>{node.cpuCores}</Table.Cell>
                <Table.Cell>{node.cpuPercent}%</Table.Cell>
                <Table.Cell>{node.memoryBytes}</Table.Cell>
                <Table.Cell>{node.memoryPercent}%</Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={5}>No node utilization data available.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
