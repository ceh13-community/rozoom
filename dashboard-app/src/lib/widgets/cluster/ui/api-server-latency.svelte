<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkApiServerLatency, updateClusterCheckPartially } from "$features/check-health";
  import type { ApiServerLatencyReport } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: ApiServerLatencyReport | null;
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

  const summaryText = $derived(health?.summary.message ?? "No latency data.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );
  const helperText = $derived.by(() =>
    health
      ? "Derived from apiserver_request_duration_seconds metrics. Treat this as SLI-style latency guidance, not a direct health endpoint."
      : "No latency metrics collected yet.",
  );

  function formatSeconds(value?: number): string {
    if (value === undefined || !Number.isFinite(value)) return "-";
    return `${value.toFixed(2)} s`;
  }

  async function refreshLatencyNow() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkApiServerLatency(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { apiServerLatency: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="API server request latency from apiserver_request_duration_seconds metrics (p50/p95/p99) and slowest groups."
    >API latency:
  </span>

  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[560px] max-h-[420px] overflow-y-auto">
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshLatencyNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Refresh latency now
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

      <div class="grid grid-cols-3 gap-2 text-xs mb-3">
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">p50</div>
          <div class="font-semibold">{formatSeconds(health?.overall.p50)}</div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">p95</div>
          <div class="font-semibold">{formatSeconds(health?.overall.p95)}</div>
        </div>
        <div class="rounded-md border p-2">
          <div class="text-muted-foreground">p99</div>
          <div class="font-semibold">{formatSeconds(health?.overall.p99)}</div>
        </div>
      </div>

      <div class="text-xs">
        <div class="font-semibold mb-1">Slowest groups</div>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Verb</Table.Head>
              <Table.Head>Resource</Table.Head>
              <Table.Head>p99</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#if health?.groups?.length}
              {#each health.groups as group (`${group.verb ?? "unknown"}-${group.resource ?? "unknown"}`)}
                <Table.Row>
                  <Table.Cell>{group.verb ?? "-"}</Table.Cell>
                  <Table.Cell>{group.resource ?? "-"}</Table.Cell>
                  <Table.Cell>{formatSeconds(group.quantiles.p99)}</Table.Cell>
                </Table.Row>
              {/each}
            {:else}
              <Table.Row>
                <Table.Cell colspan={3}>No latency breakdown available.</Table.Cell>
              </Table.Row>
            {/if}
          </Table.Body>
        </Table.Root>
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
