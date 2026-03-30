<script lang="ts">
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import * as Popover from "$shared/ui/popover";
  import * as Select from "$shared/ui/select";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkWarningEvents, updateClusterCheckPartially } from "$features/check-health";
  import type { WarningEventsReport } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: WarningEventsReport | null;
    clusterId: string;
  }

  const { health, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let isWatching = $state(false);
  let timeFilter = $state<"30" | "60" | "120">("30");
  let namespaceFilter = $state("");
  let kindFilter = $state("");
  let reasonFilter = $state("");
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

  const summaryText = $derived(health?.summary.message ?? "Warning events unavailable.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );

  const filteredItems = $derived.by(() => {
    if (!health?.items?.length) return [];
    const windowMinutes = Number(timeFilter);
    const windowMs = windowMinutes * 60 * 1000;
    const now = Date.now();
    const nsQuery = namespaceFilter.trim().toLowerCase();
    const kindQuery = kindFilter.trim().toLowerCase();
    const reasonQuery = reasonFilter.trim().toLowerCase();

    return health.items.filter((item) => {
      const inWindow = now - item.timestamp <= windowMs;
      const matchesNamespace = !nsQuery || item.namespace.toLowerCase().includes(nsQuery);
      const matchesKind = !kindQuery || item.objectKind.toLowerCase().includes(kindQuery);
      const matchesReason = !reasonQuery || item.reason.toLowerCase().includes(reasonQuery);
      return inWindow && matchesNamespace && matchesKind && matchesReason;
    });
  });

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function handleTimeFilterChange(value: string) {
    if (value === "30" || value === "60" || value === "120") {
      timeFilter = value;
    }
  }

  async function refreshWarningEvents() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkWarningEvents(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { warningEvents: fresh });
    } finally {
      isRefreshing = false;
    }
  }

  $effect(() => {
    if (!isWatching) return;
    const interval = setInterval(() => {
      void refreshWarningEvents();
    }, 30 * 1000);
    return () => clearInterval(interval);
  });
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="Warnings-only Kubernetes Events stream for recent issues.">Warning events:</span
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
        <div class="flex items-center gap-2">
          <Button variant="outline" size="sm" onclick={() => (isWatching = !isWatching)}>
            {isWatching ? "Stop watch" : "Watch events"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onclick={refreshWarningEvents}
            loading={isRefreshing}
            loadingLabel="Refreshing"
          >
            Check now
          </Button>
        </div>
      </div>

      <div class="text-xs text-muted-foreground mb-2">{summaryText}</div>
      <div class="text-[11px] text-muted-foreground mb-3">
        Events are retained only for a short time and are best-effort operational breadcrumbs, not a
        durable audit trail.
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

      <div class="flex flex-wrap items-center gap-2 mb-3">
        <Select.Root type="single" value={timeFilter} onValueChange={handleTimeFilterChange}>
          <Select.Trigger class="h-8 text-xs">
            Last {timeFilter}m
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="30">Last 30m</Select.Item>
            <Select.Item value="60">Last 60m</Select.Item>
            <Select.Item value="120">Last 120m</Select.Item>
          </Select.Content>
        </Select.Root>
        <Input
          type="search"
          placeholder="Filter namespace..."
          class="h-8 text-xs"
          bind:value={namespaceFilter}
        />
        <Input
          type="search"
          placeholder="Filter kind..."
          class="h-8 text-xs"
          bind:value={kindFilter}
        />
        <Input
          type="search"
          placeholder="Filter reason..."
          class="h-8 text-xs"
          bind:value={reasonFilter}
        />
      </div>

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Time</Table.Head>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Object</Table.Head>
            <Table.Head>Reason</Table.Head>
            <Table.Head>Message</Table.Head>
            <Table.Head>Count</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if filteredItems.length}
            {#each filteredItems as item (item.timestamp + item.objectName + item.reason)}
              <Table.Row>
                <Table.Cell>{formatTime(item.timestamp)}</Table.Cell>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.objectKind}/{item.objectName}</Table.Cell>
                <Table.Cell>{item.reason}</Table.Cell>
                <Table.Cell>{item.message}</Table.Cell>
                <Table.Cell>{item.count}</Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={6}>No warning events match the current filters.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
