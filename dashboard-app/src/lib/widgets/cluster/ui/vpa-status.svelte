<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkVpaStatus, updateClusterCheckPartially } from "$features/check-health";
  import type { VpaHealthReport } from "$features/check-health/model/types";

  interface Props {
    report: VpaHealthReport | null;
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

  const detailText = $derived(summary?.message ? `VPA: ${summary.message}` : "VPA: Unknown");

  function formatRange(value?: { cpu?: string; memory?: string }): string {
    if (!value) return "-";
    const parts = [];
    if (value.cpu) parts.push(`cpu ${value.cpu}`);
    if (value.memory) parts.push(`mem ${value.memory}`);
    return parts.length ? parts.join(", ") : "-";
  }

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkVpaStatus(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { vpaStatus: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Vertical Autoscaling (VPA):</span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[980px] max-h-[420px] overflow-y-auto" sideOffset={8}>
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
            <Table.Head>VPA</Table.Head>
            <Table.Head>Mode</Table.Head>
            <Table.Head>HPA</Table.Head>
            <Table.Head>Recommendations</Table.Head>
            <Table.Head>Issues</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if items.length}
            {#each items as item (item.namespace + item.workload + item.vpaName)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.workloadType}/{item.workload}</Table.Cell>
                <Table.Cell>{item.vpaName}</Table.Cell>
                <Table.Cell>{item.updateMode}</Table.Cell>
                <Table.Cell>{item.hpaPresent ? "yes" : "no"}</Table.Cell>
                <Table.Cell>
                  <div>min: {formatRange(item.recommendation?.min)}</div>
                  <div>target: {formatRange(item.recommendation?.target)}</div>
                  <div>max: {formatRange(item.recommendation?.max)}</div>
                </Table.Cell>
                <Table.Cell>
                  {#if item.issues.length}
                    {item.issues.join("; ")}
                  {:else}
                    -
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={7}>No VPA resources found for this cluster.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
