<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Badge } from "$shared/ui/badge";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkTopologyHa, updateClusterCheckPartially } from "$features/check-health";
  import type { TopologyHaReport } from "$features/check-health/model/types";

  interface Props {
    report: TopologyHaReport | null;
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

  const detailText = $derived(summary?.message ? `HA: ${summary.message}` : "HA: Unknown");

  function formatStrategy(item: TopologyHaReport["items"][number]): string {
    const parts = [];
    if (item.strategy.hasTopologySpreadConstraints) {
      parts.push(`topologySpread (${item.strategy.topologyKeys.join(", ") || "n/a"})`);
    }
    if (item.strategy.hasRequiredAntiAffinity) {
      parts.push("anti-affinity required");
    } else if (item.strategy.hasPreferredAntiAffinity) {
      parts.push("anti-affinity preferred");
    }
    if (!parts.length) return "none";
    return parts.join("; ");
  }

  function formatPlacement(item: TopologyHaReport["items"][number]): string {
    const nodeCount = item.placement.nodes.length;
    const zoneCount = item.placement.zones.length;
    return `nodes: ${nodeCount || "-"}, zones: ${zoneCount || "-"}`;
  }

  async function refreshNow() {
    if (isRefreshing || !clusterId) return;
    isRefreshing = true;
    try {
      const fresh = await checkTopologyHa(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { topologyHa: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 flex justify-between items-center gap-2 mb-1 mt-1 text-sm">
  <span class="font-medium text-slate-700 dark:text-slate-300">Topology / HA:</span>
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
      <div class="mb-2 text-[11px] text-muted-foreground/90">
        This summary reflects workload spread and anti-affinity posture against Kubernetes topology
        spread constraints and affinity rules. It is placement guidance, not a scheduler guarantee.
      </div>
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
            <Table.Head>Replicas</Table.Head>
            <Table.Head>Strategy</Table.Head>
            <Table.Head>Placement</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Notes</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if items.length}
            {#each items as item (item.namespace + item.workload)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.workloadType}/{item.workload}</Table.Cell>
                <Table.Cell>{item.replicas}</Table.Cell>
                <Table.Cell>{formatStrategy(item)}</Table.Cell>
                <Table.Cell>{formatPlacement(item)}</Table.Cell>
                <Table.Cell>{item.status}</Table.Cell>
                <Table.Cell>
                  {#if item.issues.length}
                    <div>{item.issues.join("; ")}</div>
                  {:else}
                    -
                  {/if}
                  {#if item.hints.length}
                    <div class="text-[10px] text-muted-foreground">{item.hints.join(" ")}</div>
                  {/if}
                  {#if item.recommendations.length}
                    <div class="mt-2 text-[10px] text-muted-foreground whitespace-pre-wrap">
                      {item.recommendations.join("\n\n")}
                    </div>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={7}>No HA topology data available.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
