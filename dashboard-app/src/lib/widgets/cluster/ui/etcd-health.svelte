<script lang="ts">
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkEtcdHealth, updateClusterCheckPartially } from "$features/check-health";
  import type { EtcdHealthReport, EtcdHealthStatus } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: EtcdHealthReport | null;
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

  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );

  function formatBytes(bytes?: number): string {
    if (bytes === undefined) return "-";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatRate(value?: number): string {
    if (value === undefined || !Number.isFinite(value)) return "-";
    return value.toFixed(2);
  }

  async function refreshEtcdHealthNow() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkEtcdHealth(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { etcdHealth: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="etcd endpoint health, latency, and storage metrics."
    >etcd health:
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
          onclick={refreshEtcdHealthNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Refresh etcd health now
        </Button>
      </div>

      <div class="mb-3 text-[11px] text-muted-foreground/90">
        This summary combines endpoint health, status, and etcd metrics when available. On managed
        control planes it may be partial or cached-first rather than a full direct etcd probe.
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

      <div class="space-y-4 text-xs">
        <div>
          <div class="font-semibold mb-1">Endpoint health</div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Endpoint</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Latency</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if health?.health?.length}
                {#each health.health as item (item.endpoint)}
                  <Table.Row>
                    <Table.Cell>{item.endpoint}</Table.Cell>
                    <Table.Cell>{item.ok ? "Healthy" : "Unhealthy"}</Table.Cell>
                    <Table.Cell>{item.tookMs ? `${item.tookMs.toFixed(1)} ms` : "-"}</Table.Cell>
                  </Table.Row>
                {/each}
              {:else}
                <Table.Row>
                  <Table.Cell colspan={3}>No endpoint health data.</Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </div>

        <div>
          <div class="font-semibold mb-1">Endpoint status</div>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Endpoint</Table.Head>
                <Table.Head>Version</Table.Head>
                <Table.Head>DB size</Table.Head>
                <Table.Head>Raft index</Table.Head>
                <Table.Head>Leader</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#if health?.endpointStatus?.length}
                {#each health.endpointStatus as item (item.endpoint)}
                  <Table.Row>
                    <Table.Cell>{item.endpoint}</Table.Cell>
                    <Table.Cell>{item.version ?? "-"}</Table.Cell>
                    <Table.Cell>{formatBytes(item.dbSizeBytes)}</Table.Cell>
                    <Table.Cell>{item.raftIndex ?? "-"}</Table.Cell>
                    <Table.Cell>
                      {item.isLeader === undefined ? "-" : item.isLeader ? "Leader" : "Follower"}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              {:else}
                <Table.Row>
                  <Table.Cell colspan={5}>No endpoint status data.</Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </div>

        <div>
          <div class="font-semibold mb-1">Basic metrics</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="rounded-md border p-2">
              <div class="text-muted-foreground">Leader changes / hour</div>
              <div class="font-semibold">
                {formatRate(health?.metricRates?.leaderChangesPerHour)}
              </div>
            </div>
            <div class="rounded-md border p-2">
              <div class="text-muted-foreground">DB growth / hour</div>
              <div class="font-semibold">
                {formatBytes(health?.metricRates?.dbSizeGrowthBytesPerHour)}
              </div>
            </div>
            <div class="rounded-md border p-2">
              <div class="text-muted-foreground">Leader present</div>
              <div class="font-semibold">
                {health?.metrics?.some((item) => (item.hasLeader ?? 0) > 0) ? "Yes" : "No"}
              </div>
            </div>
            <div class="rounded-md border p-2">
              <div class="text-muted-foreground">Max DB size</div>
              <div class="font-semibold">
                {formatBytes(
                  Math.max(0, ...(health?.metrics?.map((m) => m.dbSizeBytes ?? 0) ?? [])),
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Popover.Content>
  </Popover.Root>
</div>
