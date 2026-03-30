<script lang="ts">
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import * as Popover from "$shared/ui/popover";
  import * as Select from "$shared/ui/select";
  import * as Table from "$shared/ui/table";
  import { STATUS_CLASSES } from "$entities/cluster";
  import { checkPodIssues, updateClusterCheckPartially } from "$features/check-health";
  import type { PodIssuesReport, PodIssueType } from "$features/check-health/model/types";
  import { Badge } from "$shared/ui/badge";

  interface Props {
    health: PodIssuesReport | null;
    clusterId: string;
  }

  const { health, clusterId }: Props = $props();

  let isRefreshing = $state(false);
  let namespaceFilter = $state("");
  let statusFilter = $state<"all" | PodIssueType>("all");
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

  const summaryText = $derived(health?.summary.message ?? "Detection unavailable.");
  const warnings = $derived(health?.summary.warnings ?? []);
  const updatedAtText = $derived.by(() =>
    health?.updatedAt ? new Date(health.updatedAt).toLocaleTimeString() : "-",
  );

  const filteredItems = $derived.by(() => {
    if (!health?.items?.length) return [];
    const query = namespaceFilter.trim().toLowerCase();
    return health.items.filter((item) => {
      const matchesStatus = statusFilter === "all" || item.type === statusFilter;
      const matchesNamespace = !query || item.namespace.toLowerCase().includes(query);
      return matchesStatus && matchesNamespace;
    });
  });

  function formatAge(minutes?: number): string {
    if (minutes === undefined || !Number.isFinite(minutes)) return "-";
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const remaining = Math.floor(minutes % 60);
    return `${hours}h ${remaining}m`;
  }

  function handleStatusFilterChange(value: string) {
    statusFilter = value === "all" ? "all" : (value as PodIssueType);
  }

  async function refreshPodIssuesNow() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const fresh = await checkPodIssues(clusterId, { force: true });
      await updateClusterCheckPartially(clusterId, { podIssues: fresh });
    } finally {
      isRefreshing = false;
    }
  }
</script>

<div class="pl-1 text-sm flex justify-between items-center gap-2 mb-1 mt-1">
  <span
    class="font-medium text-slate-700 dark:text-slate-300"
    title="CrashLoopBackOff and Pending pod detectors with quick filters."
    >Pod issues:
  </span>
  <Popover.Root bind:open={isOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Badge {...props} class={`text-white ${statusClass} cursor-pointer`}>
          {statusLabel}
        </Badge>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-[720px] max-h-[420px] overflow-y-auto" sideOffset={8}>
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-xs text-muted-foreground">Last updated: {updatedAtText}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={refreshPodIssuesNow}
          loading={isRefreshing}
          loadingLabel="Refreshing"
        >
          Check now
        </Button>
      </div>

      <div class="text-xs text-muted-foreground mb-1">{summaryText}</div>
      <div class="text-[11px] text-muted-foreground/90 mb-3">
        This summary is derived from current Pod phase and restart signals such as Pending and
        CrashLoopBackOff. It is a focused workload symptom detector, not a full pod-debugging view.
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
        <Select.Root type="single" value={statusFilter} onValueChange={handleStatusFilterChange}>
          <Select.Trigger class="h-8 text-xs">
            {#if statusFilter === "all"}
              All statuses
            {:else}
              {statusFilter}
            {/if}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All statuses</Select.Item>
            <Select.Item value="crashloop">CrashLoop</Select.Item>
            <Select.Item value="pending">Pending</Select.Item>
          </Select.Content>
        </Select.Root>
        <Input
          type="search"
          placeholder="Filter namespace..."
          class="h-8 text-xs"
          bind:value={namespaceFilter}
        />
      </div>

      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Namespace</Table.Head>
            <Table.Head>Pod</Table.Head>
            <Table.Head>Status</Table.Head>
            <Table.Head>Restarts</Table.Head>
            <Table.Head>Age</Table.Head>
            <Table.Head>Reason</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#if filteredItems.length}
            {#each filteredItems as item (item.namespace + item.pod)}
              <Table.Row>
                <Table.Cell>{item.namespace}</Table.Cell>
                <Table.Cell>{item.pod}</Table.Cell>
                <Table.Cell class="capitalize">{item.type}</Table.Cell>
                <Table.Cell>{item.restarts}</Table.Cell>
                <Table.Cell>{formatAge(item.ageMinutes)}</Table.Cell>
                <Table.Cell>{item.reason ?? "-"}</Table.Cell>
              </Table.Row>
            {/each}
          {:else}
            <Table.Row>
              <Table.Cell colspan={6}>No pod issues match the current filters.</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </Popover.Content>
  </Popover.Root>
</div>
