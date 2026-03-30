<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { onMount } from "svelte";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import { selectedNamespace } from "$features/namespace-management";
  import { buildSectionSummaryItems } from "$features/section-runtime";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import TableSummaryFilterBar from "$shared/ui/table-summary-filter-bar.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import { SortingButton } from "$shared/ui/button";
  import * as Table from "$shared/ui/table";
  import { getTimeDifference, type ReplicationControllerItem } from "$shared";
  import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";
  import SectionRuntimeStatus from "./common/section-runtime-status.svelte";

  let { data }: { data: PageData & { replicationcontrollers?: ReplicationControllerItem[] } } = $props();
  let query = $state("");
  let sortBy = $state<"name" | "namespace" | "replicas" | "desired" | "selector">("name");
  let sortDirection = $state<"asc" | "desc">("asc");
  let routeLoadedAt = $state(Date.now());
  let runtimeClockNow = $state(Date.now());
  let runtimeRefreshInFlight = $state(false);

  const rows = $derived((data.replicationcontrollers ?? []) as ReplicationControllerItem[]);
  function formatSelector(replicationController: ReplicationControllerItem) {
    return replicationController.spec?.selector
      ? Object.entries(replicationController.spec.selector)
          .map(([key, value]) => `${key}=${value}`)
          .join(", ")
      : "-";
  }

  function compareText(left: string, right: string) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  function toggleSort(column: typeof sortBy) {
    if (sortBy !== column) {
      sortBy = column;
      sortDirection = "asc";
      return;
    }
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  }

  const filteredRows = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const baseRows = !normalizedQuery
      ? rows
      : rows.filter((replicationController) => {
          const selector = formatSelector(replicationController);

          return [
            replicationController.metadata?.name ?? "",
            replicationController.metadata?.namespace ?? "",
            selector,
          ].some((value) => value.toLowerCase().includes(normalizedQuery));
        });

    return [...baseRows].sort((left, right) => {
      const leftValue =
        sortBy === "name"
          ? (left.metadata?.name ?? "")
          : sortBy === "namespace"
            ? (left.metadata?.namespace ?? "")
            : sortBy === "replicas"
              ? (left.status?.readyReplicas ?? 0)
              : sortBy === "desired"
                ? (left.spec?.replicas ?? 0)
                : formatSelector(left);
      const rightValue =
        sortBy === "name"
          ? (right.metadata?.name ?? "")
          : sortBy === "namespace"
            ? (right.metadata?.namespace ?? "")
            : sortBy === "replicas"
              ? (right.status?.readyReplicas ?? 0)
              : sortBy === "desired"
                ? (right.spec?.replicas ?? 0)
                : formatSelector(right);
      const result =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : compareText(String(leftValue), String(rightValue));
      return sortDirection === "asc" ? result : result * -1;
    });
  });
  const summaryItems = $derived.by(() =>
    buildSectionSummaryItems({
      cluster: resolvePageClusterName(data),
      selectedNamespace: $selectedNamespace,
      rows: filteredRows.length,
    }),
  );
  const runtimeDetail = $derived("ReplicationController inventory is route-scoped and refreshed on demand.");
  const runtimeReason = $derived(
    `Namespace scope: ${$selectedNamespace || "all namespaces"}. Background watchers are intentionally disabled.`,
  );
  const runtimeLastUpdatedLabel = $derived.by(() => {
    void runtimeClockNow;
    return `updated ${getTimeDifference(new Date(routeLoadedAt))} ago`;
  });

  async function refreshRuntimeSection() {
    if (runtimeRefreshInFlight) return;
    runtimeRefreshInFlight = true;
    try {
      await invalidateAll();
    } finally {
      runtimeRefreshInFlight = false;
    }
  }

  onMount(() => {
    routeLoadedAt = Date.now();
    const timer = setInterval(() => {
      runtimeClockNow = Date.now();
    }, 5_000);
    return () => {
      clearInterval(timer);
    };
  });
</script>

<div class="grid gap-4">
  <TableSummaryFilterBar
    items={summaryItems}
    value={query}
    placeholder="Filter by name, namespace, or selector"
    onInput={(value) => {
      query = value;
    }}
  />
  <ResourceSummaryStrip
    items={[
      { label: "Cluster", value: resolvePageClusterName(data), tone: "foreground" },
      { label: "Namespace", value: $selectedNamespace || "all namespaces" },
      { label: "Replication Controllers", value: rows.length },
      { label: "Sync", value: "Route scoped" },
    ]}
    trailingItem={{ label: "View", value: "Table", valueClass: "text-foreground" }}
  />
  <SectionRuntimeStatus
    sectionLabel="Replication Controllers Runtime Status"
    profileLabel="Route-scoped inventory"
    sourceState={rows.length > 0 ? "cached" : "idle"}
    mode="on-demand"
    budgetSummary="route scoped"
    lastUpdatedLabel={runtimeLastUpdatedLabel}
    detail={runtimeDetail}
    secondaryActionLabel="Update"
    secondaryActionAriaLabel="Refresh replication controllers runtime section"
    secondaryActionLoading={runtimeRefreshInFlight}
    onSecondaryAction={() => void refreshRuntimeSection()}
    reason={runtimeReason}
  />
  <TableSurface>
    <Table.Root>
      <Table.Caption>A list of replication controllers.</Table.Caption>
      <Table.Header>
        <Table.Row>
          <Table.Head><SortingButton label="Name" onclick={() => toggleSort("name")} /></Table.Head>
          <Table.Head><SortingButton label="Namespace" onclick={() => toggleSort("namespace")} /></Table.Head>
          <Table.Head><SortingButton label="Replica" onclick={() => toggleSort("replicas")} /></Table.Head>
          <Table.Head><SortingButton label="Desired replicas" onclick={() => toggleSort("desired")} /></Table.Head>
          <Table.Head><SortingButton label="Selector" onclick={() => toggleSort("selector")} /></Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#if filteredRows.length === 0}
          <Table.Row>
            <Table.Cell colspan={5} class="p-0">
              <TableEmptyState message="No results for the current filter." />
            </Table.Cell>
          </Table.Row>
        {:else}
          {#each filteredRows as replicationController, i (i)}
            <Table.Row>
              <Table.Cell>{replicationController.metadata?.name}</Table.Cell>
              <Table.Cell>{replicationController.metadata?.namespace}</Table.Cell>
              <Table.Cell>{replicationController.status?.readyReplicas ?? 0}</Table.Cell>
              <Table.Cell>{replicationController.spec?.replicas ?? 0}</Table.Cell>
              <Table.Cell>
                {formatSelector(replicationController)}
              </Table.Cell>
            </Table.Row>
          {/each}
        {/if}
      </Table.Body>
    </Table.Root>
  </TableSurface>
</div>
