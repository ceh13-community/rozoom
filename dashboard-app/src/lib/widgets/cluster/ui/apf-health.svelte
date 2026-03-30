<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkApfHealth, updateClusterCheckPartially } from "$features/check-health";
  import type { ApfHealthReport } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: ApfHealthReport | null;
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

  const summaryText = $derived(health?.summary.message ?? "No APF data.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );

  function formatNumber(value?: number, digits = 0): string {
    if (value === undefined || !Number.isFinite(value)) return "-";
    return value.toFixed(digits);
  }

  function formatPercent(value?: number): string {
    if (value === undefined || !Number.isFinite(value)) return "-";
    return `${(value * 100).toFixed(1)}%`;
  }

  async function refreshApfHealthNow() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkApfHealth(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { apfHealth: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="API Priority and Fairness saturation: queue, rejects, and wait time."
    >APF status:
  </span>

  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[520px] max-h-[420px] overflow-y-auto">
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshApfHealthNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Refresh APF now
        </Button>
      </div>

      <div class="text-xs text-muted-foreground mb-1">{summaryText}</div>
      <div class="text-[11px] text-muted-foreground/90 mb-3">
        This summary reflects API Priority and Fairness queue pressure from kube-apiserver metrics.
        It is a control-plane fairness/saturation signal, not a generic API availability probe.
      </div>

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

      <div class="grid grid-cols-2 gap-2 text-xs">
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">Queue</div>
          <div class="font-semibold">{formatNumber(health?.metrics?.inQueueRequests)}</div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">Limit seats</div>
          <div class="font-semibold">
            {formatNumber(health?.metrics?.nominalLimitSeats ?? health?.metrics?.concurrencyLimit)}
          </div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">Queue utilization</div>
          <div class="font-semibold">{formatPercent(health?.metricRates?.queueUtilization)}</div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">Rejected / min</div>
          <div class="font-semibold">{formatNumber(health?.metricRates?.rejectedPerMinute, 2)}</div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">Avg wait (s)</div>
          <div class="font-semibold">{formatNumber(health?.metricRates?.avgWaitSeconds, 2)}</div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">Rejected total</div>
          <div class="font-semibold">{formatNumber(health?.metrics?.rejectedTotal)}</div>
        </div>
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
