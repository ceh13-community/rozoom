<script lang="ts">
  import { Button, SortingButton } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import InlineNotice from "$shared/ui/inline-notice.svelte";
  import { exportCsvArtifact } from "$shared/lib/text-export";
  import { computeVirtualWindow } from "$shared/lib/virtual-window";
  import TablePagination from "$shared/ui/table-pagination.svelte";
  import { totalPages as calcTotalPages } from "$shared/lib/use-pagination";
  import FileDown from "@lucide/svelte/icons/file-down";
  import { Layers3, List, Server } from "$shared/ui/icons";
  import TableChecklistDropdown from "../table-checklist-dropdown.svelte";
  import TableToolbarShell from "../table-toolbar-shell.svelte";
  import WatcherToolbarControls from "../watcher-toolbar-controls.svelte";
  import PodActionsMenu from "./pod-actions-menu.svelte";
  import PodSelectionCheckbox from "./pod-selection-checkbox.svelte";
  import { buildPodMetricsSummary } from "./model/pod-runtime-ui";
  import { getPodMetricsKey, type PodMetricsValue } from "./model/pod-row-adapter";
  import type { PodListRow } from "./model/pod-list-row";

  type DataTableProps = {
    rows: PodListRow[];
    query: string;
    onQueryChange: (value: string) => void;
    enrichedTableEnabled: boolean;
    metricsByKey: Map<string, PodMetricsValue>;
    metricsCoverageCount: number;
    metricsLoading: boolean;
    metricsError: string | null;
    metricsRecommendation: string | null;
    metricsSourcesHref: string;
    onToggleEnrichedTable: () => void;
    isSelected: (id: string) => boolean;
    areAllSelected: boolean;
    isSomeSelected: boolean;
    onToggleSelect: (id: string, next: boolean) => void;
    onToggleAll: (next: boolean) => void;
    onOpenDetails: (row: PodListRow) => void;
    onEvents: (row: PodListRow) => void;
    onShell: (row: PodListRow) => void;
    onAttach: (row: PodListRow) => void;
    onLogs: (row: PodListRow) => void;
    onEditYaml: (row: PodListRow) => void;
    onInvestigate: (row: PodListRow) => void;
    onCopyDescribe: (row: PodListRow) => void;
    onRunDebugDescribe: (row: PodListRow) => void;
    onCopyDebug: (row: PodListRow) => void;
    onPreviousLogs: (row: PodListRow) => void;
    onEvict: (row: PodListRow) => void;
    onDelete: (row: PodListRow) => void;
    isDeleting: (id: string) => boolean;
    isEvicting: (id: string) => boolean;
    watcherEnabled: boolean;
    watcherRefreshSeconds: number;
    watcherError: string | null;
    onToggleWatcher: () => void;
    onWatcherRefreshSecondsChange: (value: number) => void;
    onResetWatcherSettings: () => void;
  };

  type ViewMode = "flat" | "namespace" | "node";
  type ColumnId =
    | "name"
    | "namespace"
    | "status"
    | "ready"
    | "cpu"
    | "memory"
    | "restarts"
    | "node"
    | "age";
  type ColumnConfig = {
    id: ColumnId;
    label: string;
    visible: boolean;
  };
  type SortDirection = "asc" | "desc";

  let {
    rows,
    query,
    onQueryChange,
    enrichedTableEnabled,
    metricsByKey,
    metricsCoverageCount,
    metricsLoading,
    metricsError,
    metricsRecommendation,
    metricsSourcesHref,
    onToggleEnrichedTable,
    isSelected,
    areAllSelected,
    isSomeSelected,
    onToggleSelect,
    onToggleAll,
    onOpenDetails,
    onEvents,
    onShell,
    onAttach,
    onLogs,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onRunDebugDescribe,
    onCopyDebug,
    onPreviousLogs,
    onEvict,
    onDelete,
    isDeleting,
    isEvicting,
    watcherEnabled,
    watcherRefreshSeconds,
    watcherError,
    onToggleWatcher,
    onWatcherRefreshSecondsChange,
    onResetWatcherSettings,
  }: DataTableProps = $props();

  let viewMode = $state<ViewMode>("flat");
  let sortColumn = $state<ColumnId>("name");
  let sortDirection = $state<SortDirection>("asc");
  let collapsedGroups = $state(new Set<string>());
  let selectedNamespaces = $state(new Set<string>());
  let namespacesInitialized = false;
  let previousAvailableNamespaces: string[] = [];
  let columnConfigs = $state<ColumnConfig[]>([
    { id: "name", label: "Name", visible: true },
    { id: "namespace", label: "Namespace", visible: true },
    { id: "status", label: "Status", visible: true },
    { id: "ready", label: "Ready", visible: true },
    { id: "cpu", label: "CPU", visible: true },
    { id: "memory", label: "Memory", visible: true },
    { id: "restarts", label: "Restarts", visible: true },
    { id: "node", label: "Node", visible: true },
    { id: "age", label: "Age", visible: true },
  ]);

  function getMetricsForRow(row: PodListRow) {
    return metricsByKey.get(
      getPodMetricsKey({
        metadata: {
          namespace: row.namespace,
          name: row.name,
        },
      }),
    );
  }

  const metricsSummary = $derived.by(() => {
    return buildPodMetricsSummary({
      enrichedTableEnabled,
      metricsLoading,
      metricsError,
      rows,
      metricsCoverageCount,
    });
  });

  function getStatusClass(status: string) {
    const normalized = status.trim().toLowerCase();
    if (normalized.includes("running")) return "pods-k9s-status-running";
    if (normalized.includes("completed") || normalized.includes("succeeded")) {
      return "pods-k9s-status-completed";
    }
    if (normalized.includes("pending")) return "pods-k9s-status-pending";
    if (normalized.includes("error") || normalized.includes("crash") || normalized.includes("failed")) {
      return "pods-k9s-status-error";
    }
    return "pods-k9s-status-neutral";
  }

  function getAvailableNamespaces() {
    return [...new Set(rows.map((row) => row.namespace))].sort((left, right) => left.localeCompare(right));
  }

  const namespaceFilteredRows = $derived.by(() => {
    if (selectedNamespaces.size === 0) return [];
    return rows.filter((row) => selectedNamespaces.has(row.namespace));
  });

  function compareText(left: string, right: string) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  }

  function getSortValue(row: PodListRow, column: ColumnId) {
    if (column === "name") return row.name;
    if (column === "namespace") return row.namespace;
    if (column === "status") return row.status;
    if (column === "ready") return row.readyContainers / Math.max(row.totalContainers, 1);
    if (column === "restarts") return row.restarts;
    if (column === "node") return row.node;
    if (column === "age") return row.ageSeconds;
    if (column === "cpu") return getMetricsForRow(row)?.cpuMillicores ?? -1;
    if (column === "memory") return getMetricsForRow(row)?.memoryBytes ?? -1;
    return row.name;
  }

  function compareRows(left: PodListRow, right: PodListRow) {
    const leftValue = getSortValue(left, sortColumn);
    const rightValue = getSortValue(right, sortColumn);

    let result =
      typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : compareText(String(leftValue), String(rightValue));

    if (result === 0) {
      result = compareText(left.namespace, right.namespace) || compareText(left.name, right.name);
    }

    return sortDirection === "asc" ? result : result * -1;
  }

  const sortedRows = $derived.by(() => [...namespaceFilteredRows].sort(compareRows));

  const VIRTUAL_ROW_HEIGHT = 42;
  let tableScrollTop = $state(0);
  let tableViewportHeight = $state(560);
  let podPageIndex = $state(0);
  let podPageSize = $state(100);

  function handleTableScroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement | null;
    if (!target) return;
    tableScrollTop = target.scrollTop;
    if (target.clientHeight > 0) {
      tableViewportHeight = target.clientHeight;
    }
  }

  const podTotalPages = $derived(calcTotalPages(sortedRows.length, podPageSize));
  const paginatedPods = $derived(sortedRows.slice(podPageIndex * podPageSize, (podPageIndex + 1) * podPageSize));

  const flatVirtualWindow = $derived.by(() =>
    computeVirtualWindow({
      totalCount: paginatedPods.length,
      rowHeight: VIRTUAL_ROW_HEIGHT,
      viewportHeight: tableViewportHeight,
      scrollTop: tableScrollTop,
      overscan: 10,
    }),
  );
  const flatVisibleRows = $derived.by(() =>
    paginatedPods.slice(flatVirtualWindow.startIndex, flatVirtualWindow.endIndex),
  );

  function getGroupedRows() {
    const groups = new Map<string, PodListRow[]>();
    for (const row of sortedRows) {
      const groupKey = viewMode === "node" ? (row.node?.trim() || "Unscheduled") : row.namespace;
      const bucket = groups.get(groupKey) ?? [];
      bucket.push(row);
      groups.set(groupKey, bucket);
    }
    return [...groups.entries()].sort(([left], [right]) => compareText(left, right));
  }

  function toggleSort(column: ColumnId) {
    if (sortColumn !== column) {
      sortColumn = column;
      sortDirection = "asc";
      return;
    }
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  }

  function getNamespaceEntries() {
    return getAvailableNamespaces().map((namespace) => ({
      id: namespace,
      label: namespace,
      checked: selectedNamespaces.has(namespace),
    }));
  }

  function toggleNamespace(namespace: string, checked: boolean) {
    const next = new Set(selectedNamespaces);
    if (checked) next.add(namespace);
    else next.delete(namespace);
    selectedNamespaces = next;
  }

  function selectAllNamespaces() {
    selectedNamespaces = new Set(getAvailableNamespaces());
  }

  function clearAllNamespaces() {
    selectedNamespaces = new Set();
  }

  function eventTargetsPodActionsArea(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest("[data-pod-actions-menu='true']"));
  }

  function getColumnEntries() {
    return columnConfigs
      .filter((column) => enrichedTableEnabled || (column.id !== "cpu" && column.id !== "memory"))
      .map((column) => ({
        id: column.id,
        label: column.label,
        checked: column.visible,
      }));
  }

  function toggleColumnVisibility(columnId: string, checked: boolean) {
    columnConfigs = columnConfigs.map((column) =>
      column.id === columnId ? { ...column, visible: checked } : column,
    );
  }

  function showAllColumns() {
    columnConfigs = columnConfigs.map((column) =>
      enrichedTableEnabled || (column.id !== "cpu" && column.id !== "memory")
        ? { ...column, visible: true }
        : column,
    );
  }

  function hideAllColumns() {
    columnConfigs = columnConfigs.map((column) =>
      enrichedTableEnabled || (column.id !== "cpu" && column.id !== "memory")
        ? { ...column, visible: false }
        : column,
    );
  }

  function isColumnVisible(columnId: ColumnId) {
    return columnConfigs.find((column) => column.id === columnId)?.visible ?? true;
  }

  function buildGridColumns() {
    const columns = ["auto", "auto"];
    if (isColumnVisible("name")) columns.push("minmax(0,2fr)");
    if (isColumnVisible("namespace")) columns.push("minmax(0,1fr)");
    if (isColumnVisible("status")) columns.push("minmax(0,1fr)");
    if (isColumnVisible("ready")) columns.push("minmax(0,0.8fr)");
    if (enrichedTableEnabled && isColumnVisible("cpu")) columns.push("minmax(0,0.9fr)");
    if (enrichedTableEnabled && isColumnVisible("memory")) columns.push("minmax(0,0.9fr)");
    if (isColumnVisible("restarts")) columns.push("minmax(0,0.8fr)");
    if (isColumnVisible("node")) columns.push("minmax(0,1.1fr)");
    if (isColumnVisible("age")) columns.push("minmax(0,0.8fr)");
    return columns.join(" ");
  }

  const tableGridTemplate = $derived(buildGridColumns());

  function getGroupId(groupKey: string) {
    return `namespace:${groupKey}`;
  }

  function isGroupCollapsed(groupKey: string) {
    return collapsedGroups.has(getGroupId(groupKey));
  }

  function toggleGroup(groupKey: string) {
    const next = new Set(collapsedGroups);
    const id = getGroupId(groupKey);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedGroups = next;
  }

  function toggleAllGroups() {
    const visibleGroupIds = getGroupedRows().map(([groupKey]) => getGroupId(groupKey));
    const allCollapsed =
      visibleGroupIds.length > 0 && visibleGroupIds.every((groupId) => collapsedGroups.has(groupId));
    collapsedGroups = allCollapsed ? new Set<string>() : new Set(visibleGroupIds);
  }

  function getToggleAllGroupsLabel() {
    const visibleGroupIds = getGroupedRows().map(([groupKey]) => getGroupId(groupKey));
    const allCollapsed =
      visibleGroupIds.length > 0 && visibleGroupIds.every((groupId) => collapsedGroups.has(groupId));
    return allCollapsed ? "Expand groups" : "Collapse groups";
  }

  function toCsvCell(value: unknown) {
    if (value === null || value === undefined) return "";
    const text = String(value).replaceAll('"', '""');
    return `"${text}"`;
  }

  async function downloadCsv() {
    const headers = getColumnEntries().filter((column) => column.checked).map((column) => column.label);
    const lines = [headers.map(toCsvCell).join(",")];
    for (const row of namespaceFilteredRows) {
      const values: unknown[] = [];
      if (isColumnVisible("name")) values.push(row.name);
      if (isColumnVisible("namespace")) values.push(row.namespace);
      if (isColumnVisible("status")) values.push(row.status);
      if (isColumnVisible("ready")) values.push(`${row.readyContainers}/${row.totalContainers}`);
      if (enrichedTableEnabled && isColumnVisible("cpu")) values.push(getMetricsForRow(row)?.cpu ?? "n/a");
      if (enrichedTableEnabled && isColumnVisible("memory")) values.push(getMetricsForRow(row)?.memory ?? "n/a");
      if (isColumnVisible("restarts")) values.push(row.restarts);
      if (isColumnVisible("node")) values.push(row.node);
      if (isColumnVisible("age")) values.push(row.age);
      lines.push(values.map(toCsvCell).join(","));
    }
    await exportCsvArtifact({ filename: "pods.csv", csv: lines.join("\n") });
  }

  $effect(() => {
    const availableNamespaces = getAvailableNamespaces();
    if (!namespacesInitialized) {
      selectedNamespaces = new Set(availableNamespaces);
      previousAvailableNamespaces = availableNamespaces;
      namespacesInitialized = true;
      return;
    }

    const availableSet = new Set(availableNamespaces);
    const previousSet = new Set(previousAvailableNamespaces);
    const hadAllPreviousSelected = previousAvailableNamespaces.every((namespace) =>
      selectedNamespaces.has(namespace),
    );
    const next = new Set<string>();
    for (const namespace of selectedNamespaces) {
      if (availableSet.has(namespace)) next.add(namespace);
    }
    if (hadAllPreviousSelected) {
      for (const namespace of availableNamespaces) {
        if (!previousSet.has(namespace)) next.add(namespace);
      }
    }

    const changed =
      next.size !== selectedNamespaces.size || [...next].some((namespace) => !selectedNamespaces.has(namespace));
    previousAvailableNamespaces = availableNamespaces;
    if (changed) {
      selectedNamespaces = next;
    }
  });
</script>

<div class="grid gap-4">
  <TableToolbarShell>
    {#snippet children()}
      <Input
        value={query}
        placeholder="Filter pods..."
        oninput={(event) => {
          onQueryChange((event.currentTarget as HTMLInputElement).value);
        }}
        class="w-full max-w-xl"
      />
    {/snippet}
    {#snippet actions()}
      <TableChecklistDropdown
        label={`NS (${selectedNamespaces.size}/${getAvailableNamespaces().length})`}
        entries={getNamespaceEntries()}
        onToggle={toggleNamespace}
        onSelectAll={selectAllNamespaces}
        onClearAll={clearAllNamespaces}
      />
      <TableChecklistDropdown
        label="Columns"
        entries={getColumnEntries()}
        onToggle={toggleColumnVisibility}
        onSelectAll={showAllColumns}
        onClearAll={hideAllColumns}
      />
      <Button variant="outline" size="sm" onclick={downloadCsv} title="Download CSV" aria-label="Download CSV">
        <FileDown class="mr-1 h-4 w-4" />
        Download CSV
      </Button>
      <div class="flex items-center gap-1 rounded border bg-background p-1">
        <button
          type="button"
          class={`rounded p-1.5 ${viewMode === "flat" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onclick={() => (viewMode = "flat")}
          title="Flat list"
          aria-label="Flat list"
        >
          <List class="h-4 w-4" />
        </button>
        <button
          type="button"
          class={`rounded p-1.5 ${viewMode === "namespace" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onclick={() => (viewMode = "namespace")}
          title="Group by namespace"
          aria-label="Group by namespace"
        >
          <Layers3 class="h-4 w-4" />
        </button>
        <button
          type="button"
          class={`rounded p-1.5 ${viewMode === "node" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          onclick={() => (viewMode = "node")}
          title="Group by node"
          aria-label="Group by node"
        >
          <Server class="h-4 w-4" />
        </button>
      </div>
      <Button
        variant={enrichedTableEnabled ? "secondary" : "outline"}
        size="sm"
        onclick={onToggleEnrichedTable}
      >
        {enrichedTableEnabled ? "Hide live usage" : "Show live usage"}
      </Button>
      <WatcherToolbarControls
        {watcherEnabled}
        {watcherRefreshSeconds}
        onToggleWatcher={onToggleWatcher}
        onWatcherRefreshSecondsChange={onWatcherRefreshSecondsChange}
        onResetWatcherSettings={onResetWatcherSettings}
      />
      {#if (viewMode === "namespace" || viewMode === "node") && getGroupedRows().length > 0}
        <Button variant="outline" size="sm" onclick={toggleAllGroups}>
          {getToggleAllGroupsLabel()}
        </Button>
      {/if}
    {/snippet}
  </TableToolbarShell>

  <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
    <div>
      Rows: <span class="font-medium text-foreground">{sortedRows.length}</span>
    </div>
    <div>
      Watcher: <span class="font-medium text-foreground">{watcherEnabled ? "Active" : "Paused"}</span>
    </div>
    <div class="min-w-[18rem] flex-1">{metricsSummary}</div>
  </div>

  {#if watcherError}
    <div class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {watcherError}
    </div>
  {/if}

  {#if enrichedTableEnabled && metricsError}
    <InlineNotice variant="destructive" title="Live pod usage unavailable">
      Live pod usage could not be loaded. {metricsError}
      {#if metricsRecommendation}
        <span class="ml-1">{metricsRecommendation}</span>
        <a
          href={metricsSourcesHref}
          class="ml-1 font-medium underline underline-offset-2 hover:text-foreground"
        >
          Open Metrics Sources
        </a>
        .
      {/if}
    </InlineNotice>
  {/if}

  <div class="grid w-full grid-cols-1 overflow-visible">
    <div class="pods-k9s-table max-h-[70vh] overflow-auto rounded-lg border border-border/60 bg-background/40" onscroll={handleTableScroll}>
      <div
        class="sticky-table-header pods-k9s-table__header grid gap-3 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        style={`grid-template-columns: ${tableGridTemplate};`}
      >
        <div>
          <PodSelectionCheckbox
            checked={areAllSelected}
            indeterminate={isSomeSelected}
            label="Select all pods"
            onToggle={onToggleAll}
          />
        </div>
        <div>Actions</div>
        {#if isColumnVisible("name")}<SortingButton label="Name" onclick={() => toggleSort("name")} />{/if}
        {#if isColumnVisible("namespace")}<SortingButton label="Namespace" onclick={() => toggleSort("namespace")} />{/if}
        {#if isColumnVisible("status")}<SortingButton label="Status" onclick={() => toggleSort("status")} />{/if}
        {#if isColumnVisible("ready")}<SortingButton label="Ready" onclick={() => toggleSort("ready")} />{/if}
        {#if enrichedTableEnabled && isColumnVisible("cpu")}<SortingButton label="CPU" onclick={() => toggleSort("cpu")} />{/if}
        {#if enrichedTableEnabled && isColumnVisible("memory")}<SortingButton label="Memory" onclick={() => toggleSort("memory")} />{/if}
        {#if isColumnVisible("restarts")}<SortingButton label="Restarts" onclick={() => toggleSort("restarts")} />{/if}
        {#if isColumnVisible("node")}<SortingButton label="Node" onclick={() => toggleSort("node")} />{/if}
        {#if isColumnVisible("age")}<SortingButton label="Age" onclick={() => toggleSort("age")} />{/if}
      </div>

      {#if sortedRows.length === 0}
        <div class="px-4 py-6 text-sm text-muted-foreground">
          No pods found for the current filter.
        </div>
      {:else if viewMode === "namespace" || viewMode === "node"}
        {#each getGroupedRows() as [groupKey, groupRows] (groupKey)}
          <div class="border-b border-border/60">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted/20"
              onclick={() => toggleGroup(groupKey)}
            >
              <span>{groupKey}</span>
              <span>{isGroupCollapsed(groupKey) ? `Show ${groupRows.length}` : `Hide ${groupRows.length}`}</span>
            </button>
            {#if !isGroupCollapsed(groupKey)}
              {#each groupRows as row (row.uid)}
                <div
                  class={`pods-k9s-table__row grid gap-3 border-t border-border/60 px-4 py-2.5 text-sm transition-colors ${isSelected(row.uid) ? "bg-muted/30" : "hover:bg-muted/20"}`}
                  style={`grid-template-columns: ${tableGridTemplate};`}
                  role="button"
                  tabindex="0"
                  onclick={(event) => {
                    if (eventTargetsPodActionsArea(event)) return;
                    onOpenDetails(row);
                  }}
                  onkeydown={(event) => {
                    if (eventTargetsPodActionsArea(event)) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenDetails(row);
                    }
                  }}
                >
                  <div
                    class="flex items-center"
                    role="presentation"
                    onclick={(event) => event.stopPropagation()}
                    onkeydown={(event) => event.stopPropagation()}
                    onpointerdown={(event) => event.stopPropagation()}
                  >
                    <PodSelectionCheckbox
                      checked={isSelected(row.uid)}
                      label={`Select pod ${row.name}`}
                      onToggle={(next) => {
                        onToggleSelect(row.uid, next);
                      }}
                    />
                  </div>
                  <div class="flex items-center">
                    <PodActionsMenu
                      name={row.name}
                      namespace={row.namespace}
                      showExportIncident={false}
                      showDownloadYaml={false}
                      showPortForward={false}
                      isDeleting={isDeleting(row.uid)}
                      isEvicting={isEvicting(row.uid)}
                      isYamlBusy={false}
                      isExportingIncident={false}
                      isDownloadingYaml={false}
                      onShowDetails={() => onOpenDetails(row)}
                      onEvents={() => onEvents(row)}
                      onShell={() => onShell(row)}
                      onAttach={() => onAttach(row)}
                      onEditYaml={() => onEditYaml(row)}
                      onInvestigate={() => onInvestigate(row)}
                      onExportIncident={() => {}}
                      onDownloadYaml={() => {}}
                      onCopyDescribe={() => onCopyDescribe(row)}
                      onRunDebugDescribe={() => onRunDebugDescribe(row)}
                      onCopyDebug={() => onCopyDebug(row)}
                      onPreviousLogs={() => onPreviousLogs(row)}
                      onPortForward={() => {}}
                      onEvict={() => onEvict(row)}
                      onLogs={() => onLogs(row)}
                      onDelete={() => onDelete(row)}
                    />
                  </div>
                  {#if isColumnVisible("name")}
                    <div class="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline">{row.name}</div>
                  {/if}
                  {#if isColumnVisible("namespace")}
                    <div class="min-w-0 truncate text-muted-foreground">{row.namespace}</div>
                  {/if}
                  {#if isColumnVisible("status")}
                    <div class={`min-w-0 truncate ${getStatusClass(row.status)}`}>{row.status}</div>
                  {/if}
                  {#if isColumnVisible("ready")}
                    <div class="min-w-0 truncate text-muted-foreground">
                      {row.readyContainers}/{row.totalContainers}
                    </div>
                  {/if}
                  {#if enrichedTableEnabled && isColumnVisible("cpu")}
                    <div class="min-w-0 truncate text-muted-foreground">
                      {#if metricsLoading}
                        Loading…
                      {:else}
                        {getMetricsForRow(row)?.cpu ?? "n/a"}
                      {/if}
                    </div>
                  {/if}
                  {#if enrichedTableEnabled && isColumnVisible("memory")}
                    <div class="min-w-0 truncate text-muted-foreground">
                      {#if metricsLoading}
                        Loading…
                      {:else}
                        {getMetricsForRow(row)?.memory ?? "n/a"}
                      {/if}
                    </div>
                  {/if}
                  {#if isColumnVisible("restarts")}
                    <div class="min-w-0 truncate text-muted-foreground">{row.restarts}</div>
                  {/if}
                  {#if isColumnVisible("node")}
                    <div class="min-w-0 truncate text-muted-foreground">{row.node}</div>
                  {/if}
                  {#if isColumnVisible("age")}
                    <div class="min-w-0 truncate text-muted-foreground">{row.age}</div>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/each}
      {:else}
          {#if flatVirtualWindow.paddingTop > 0}
            <div aria-hidden="true" style={`height:${flatVirtualWindow.paddingTop}px;`}></div>
          {/if}
          {#each flatVisibleRows as row (row.uid)}
            <div
            class={`pods-k9s-table__row grid gap-3 border-b border-border/60 px-4 py-2.5 text-sm transition-colors ${isSelected(row.uid) ? "bg-muted/30" : "hover:bg-muted/20"}`}
            style={`grid-template-columns: ${tableGridTemplate};`}
            role="button"
            tabindex="0"
            onclick={(event) => {
              if (eventTargetsPodActionsArea(event)) return;
              onOpenDetails(row);
            }}
            onkeydown={(event) => {
              if (eventTargetsPodActionsArea(event)) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenDetails(row);
              }
            }}
          >
            <div
              class="flex items-center"
              role="presentation"
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
              onpointerdown={(event) => event.stopPropagation()}
            >
              <PodSelectionCheckbox
                checked={isSelected(row.uid)}
                label={`Select pod ${row.name}`}
                onToggle={(next) => {
                  onToggleSelect(row.uid, next);
                }}
              />
            </div>
            <div class="flex items-center">
              <PodActionsMenu
                name={row.name}
                namespace={row.namespace}
                showExportIncident={false}
                showDownloadYaml={false}
                showPortForward={false}
                isDeleting={isDeleting(row.uid)}
                isEvicting={isEvicting(row.uid)}
                isYamlBusy={false}
                isExportingIncident={false}
                isDownloadingYaml={false}
                onShell={() => onShell(row)}
                onAttach={() => onAttach(row)}
                onEditYaml={() => onEditYaml(row)}
                onInvestigate={() => onInvestigate(row)}
                onExportIncident={() => {}}
                onDownloadYaml={() => {}}
                onCopyDescribe={() => onCopyDescribe(row)}
                onRunDebugDescribe={() => onRunDebugDescribe(row)}
                onCopyDebug={() => onCopyDebug(row)}
                onPreviousLogs={() => onPreviousLogs(row)}
                onPortForward={() => {}}
                onEvict={() => onEvict(row)}
                onLogs={() => onLogs(row)}
                onDelete={() => onDelete(row)}
              />
            </div>
            {#if isColumnVisible("name")}
              <div class="min-w-0 truncate font-medium text-foreground underline-offset-2 hover:underline">{row.name}</div>
            {/if}
            {#if isColumnVisible("namespace")}
              <div class="min-w-0 truncate text-muted-foreground">{row.namespace}</div>
            {/if}
            {#if isColumnVisible("status")}
              <div class={`min-w-0 truncate ${getStatusClass(row.status)}`}>{row.status}</div>
            {/if}
            {#if isColumnVisible("ready")}
              <div class="min-w-0 truncate text-muted-foreground">
                {row.readyContainers}/{row.totalContainers}
              </div>
            {/if}
            {#if enrichedTableEnabled && isColumnVisible("cpu")}
              <div class="min-w-0 truncate text-muted-foreground">
                {#if metricsLoading}
                  Loading…
                {:else}
                  {getMetricsForRow(row)?.cpu ?? "n/a"}
                {/if}
              </div>
            {/if}
            {#if enrichedTableEnabled && isColumnVisible("memory")}
              <div class="min-w-0 truncate text-muted-foreground">
                {#if metricsLoading}
                  Loading…
                {:else}
                  {getMetricsForRow(row)?.memory ?? "n/a"}
                {/if}
              </div>
            {/if}
            {#if isColumnVisible("restarts")}
              <div class="min-w-0 truncate text-muted-foreground">{row.restarts}</div>
            {/if}
            {#if isColumnVisible("node")}
              <div class="min-w-0 truncate text-muted-foreground">{row.node}</div>
            {/if}
            {#if isColumnVisible("age")}
              <div class="min-w-0 truncate text-muted-foreground">{row.age}</div>
            {/if}
          </div>
        {/each}
          {#if flatVirtualWindow.paddingBottom > 0}
            <div aria-hidden="true" style={`height:${flatVirtualWindow.paddingBottom}px;`}></div>
          {/if}
      {/if}
    </div>
  </div>
  <TablePagination
    currentPage={podPageIndex}
    totalPages={podTotalPages}
    totalRows={sortedRows.length}
    pageSize={podPageSize}
    onPageChange={(p) => { podPageIndex = p; tableScrollTop = 0; }}
    onPageSizeChange={(s) => { podPageSize = s; podPageIndex = 0; tableScrollTop = 0; }}
  />
</div>
