<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkBlackboxProbes, updateClusterCheckPartially } from "$features/check-health";
  import type { BlackboxProbeReport } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: BlackboxProbeReport | null;
    clusterId: string;
  }

  const { health, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isOpen = $state(false);

  const statusLabel = $derived.by(() => {
    if (!health) return "Unknown";
    if (health.status === "ok") return "OK";
    if (health.status === "warning") return "Warning";
    if (health.status === "critical") return "Critical";
    return "Unknown";
  });

  const statusClass = $derived.by(() => {
    if (!health) return STATUS_CLASSES.unknown;
    if (health.status === "ok") return STATUS_CLASSES.ok;
    if (health.status === "warning") return STATUS_CLASSES.warning;
    if (health.status === "critical") return STATUS_CLASSES.error;
    return STATUS_CLASSES.unknown;
  });

  const summaryText = $derived(health?.summary.message ?? "Blackbox probe data unavailable.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );
  const helperText = $derived.by(() =>
    health?.items?.length
      ? "Based on discovered ingress and LoadBalancer targets plus optional blackbox-exporter metrics. This is external reachability guidance, not core Kubernetes API health."
      : "No ingress or LoadBalancer targets are currently available for blackbox-style reachability checks.",
  );

  function formatDuration(value?: number): string {
    return value === undefined ? "-" : `${value.toFixed(2)}s`;
  }

  function formatDays(value?: number): string {
    return value === undefined ? "-" : `${value}d`;
  }

  async function refreshBlackboxProbes() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkBlackboxProbes(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { blackboxProbes: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="Synthetic/external checks for discovered ingress and LoadBalancer targets plus TLS expiry.">Blackbox probes:</span
  >
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[760px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshBlackboxProbes}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Check now
        </Button>
      </div>

      <div class="text-xs text-muted-foreground mb-1">{summaryText}</div>
      <div class="text-[11px] text-muted-foreground/90 mb-3">{helperText}</div>

      {#if warnings.length}
        <div class="mb-3 rounded-md border border-orange-400/40 bg-orange-400/10 p-2 text-xs">
          <div class="font-semibold text-orange-400">Warnings</div>
          <ul class="list-disc pl-4">
            {#each warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        </div>
      {/if}

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Target</Table.Head>
            <Table.Head>Source</Table.Head>
            <Table.Head>Module</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Duration</Table.Head>
            <Table.Head>TLS days</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if health?.items?.length}
            {#each health.items as item (item.target)}
              <Table.Row>
                <Table.Cell>{item.target}</Table.Cell>
                <Table.Cell>{item.source}</Table.Cell>
                <Table.Cell>{item.module ?? "-"}</Table.Cell>
                <Table.Cell class="capitalize">{item.status}</Table.Cell>
                <Table.Cell>{formatDuration(item.durationSeconds)}</Table.Cell>
                <Table.Cell>{formatDays(item.sslDaysLeft)}</Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={6}>No blackbox targets detected.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
