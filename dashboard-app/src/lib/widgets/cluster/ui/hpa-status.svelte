<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkHpaStatus, updateClusterCheckPartially } from "$features/check-health";
  import type { HpaCheckReport } from "$features/check-health/model/types";

  interface Props {
    report: HpaCheckReport | null;
    clusterId: string;
  }

  const { report, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const summary = $derived(report?.summary ?? null);
  const items = $derived(report?.items ?? []);
  const updatedAtText = $derived.by(() =>
    report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString() : "-",
  );

  const statusLabel = $derived.by(() => {
    if (!summary) return "Unknown";
    if (summary.status === "ok") return "OK";
    if (summary.status === "warning") return "Warning";
    if (summary.status === "critical") return "Critical";
    if (summary.status === "unreachable") return "Unreachable";
    if (summary.status === "insufficient") return "Insufficient permissions";
    return "Unknown";
  });

  const statusClass = $derived.by(() => {
    if (!summary) return STATUS_CLASSES.unknown;
    if (summary.status === "ok") return STATUS_CLASSES.ok;
    if (summary.status === "warning") return STATUS_CLASSES.warning;
    if (summary.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const detailText = $derived(
    summary?.message ? `HPA: ${summary.message} (${summary.total})` : "HPA: Unknown",
  );

  function formatMetrics(metrics: HpaCheckReport["items"][number]["metrics"]): string {
    if (!metrics.labels.length) return "-";
    return metrics.labels.join(", ");
  }

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkHpaStatus(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { hpaStatus: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Autoscaling (HPA):</span>
  <Popover.Root>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[820px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <p>{detailText}</p>
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

      {#if report?.errors}
        <div class="mb-3 rounded-md border border-slate-300 bg-slate-50 p-2 text-xs text-slate-600">
          {report.errors}
        </div>
      {/if}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Workload</Table.Head>
            <Table.Head>HPA</Table.Head>
            <Table.Head>Min/Max</Table.Head>
            <Table.Head>Current/Desired</Table.Head>
            <Table.Head>Metrics</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Reason</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if items.length}
            {#each items as item (item.namespace + item.workload + item.hpaName)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.workloadType}/{item.workload}</Table.Cell>
                <Table.Cell>{item.hpaName}</Table.Cell>
                <Table.Cell>
                  {item.minReplicas ?? "-"}/{item.maxReplicas ?? "-"}
                </Table.Cell>
                <Table.Cell>
                  {item.currentReplicas ?? "-"}/{item.desiredReplicas ?? "-"}
                </Table.Cell>
                <Table.Cell>{formatMetrics(item.metrics)}</Table.Cell>
                <Table.Cell>{item.status}</Table.Cell>
                <Table.Cell>
                  {item.reason ?? "-"}
                  {#if item.message}
                    <div class="text-[10px] text-muted-foreground">{item.message}</div>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={8}>No HPA resources found for this cluster.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
