<script lang="ts" generics="TData extends { uid: string; name: string; namespace: string }">
  import {
    type ColumnDef,
    type SortingState,
    type ColumnFiltersState,
    type VisibilityState,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
  } from "@tanstack/table-core";
  import { createSvelteTable, FlexRender, TableHeaderCell } from "$shared/ui/data-table/index.js";
  import * as Table from "$shared/ui/table/index.js";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import { computeVirtualWindow } from "$shared/lib/virtual-window";
  import { Button } from "$shared/ui/button";
  import TablePagination from "$shared/ui/table-pagination.svelte";
  import { Input } from "$shared/ui/input";
  import FileDown from "@lucide/svelte/icons/file-down";
  import { ChevronDown, Layers3, List } from "$shared/ui/icons";
  import StatefulSetSelectionCheckbox from "./statefulset-selection-checkbox.svelte";
  import TableToolbarShell from "../table-toolbar-shell.svelte";
  import {
    getGroupCollapseToggleLabel,
    toggleAllGroupsCollapsed,
  } from "../model/group-collapse-toggle";
  import TableChecklistDropdown from "../table-checklist-dropdown.svelte";
  import WatcherToolbarControls from "../watcher-toolbar-controls.svelte";
  import { exportCsvArtifact } from "$shared/lib/text-export";

  export type StatefulSetsTableViewMode = "flat" | "namespace";

  type DataTableProps<TData> = {
    columns: ColumnDef<TData>[];
    data: TData[];
    onRowClick: (row: TData) => void;
    isRowSelected?: (row: TData) => boolean;
    onToggleGroupSelection?: (groupKey: string, next: boolean, rowIds: string[]) => void;
    watcherEnabled: boolean;
    watcherRefreshSeconds: number;
    watcherError: string | null;
    onToggleWatcher: () => void;
    onWatcherRefreshSecondsChange: (value: number) => void;
    onResetWatcherSettings: () => void;
    viewMode: StatefulSetsTableViewMode;
    onViewModeChange: (mode: StatefulSetsTableViewMode) => void;
    onCsvDownloaded?: (payload: { pathHint: string; rows: number }) => void;
  };

  let {
    data,
    columns,
    onRowClick,
    isRowSelected = () => false,
    onToggleGroupSelection = () => {},
    watcherEnabled,
    watcherRefreshSeconds,
    watcherError,
    onToggleWatcher,
    onWatcherRefreshSecondsChange,
    onResetWatcherSettings,
    viewMode,
    onViewModeChange,
    onCsvDownloaded = () => {},
  }: DataTableProps<TData> = $props();

  let paginationPageIndex = $state(0);
  let paginationPageSize = $state(100);
  let sorting = $state<SortingState>([{ id: "problemScore", desc: true }]);
  let columnFilters = $state<ColumnFiltersState>([]);
  let columnVisibility = $state<VisibilityState>({ problemScore: false });
  let collapsedGroups = $state(new Set<string>());
  let selectedNamespaces = $state(new Set<string>());
  let namespacesInitialized = false;
  let previousAvailableNamespaces: string[] = [];
  const VIRTUAL_ROW_HEIGHT = 42;
  let tableScrollTop = $state(0);
  let tableViewportHeight = $state(560);

  function handleTableScroll(event: Event) {
    const target = event.currentTarget as HTMLDivElement | null;
    if (!target) return;
    tableScrollTop = target.scrollTop;
    if (target.clientHeight > 0) tableViewportHeight = target.clientHeight;
  }

  function getAvailableNamespaces() {
    return [...new Set(data.map((row) => row.namespace))].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  function getNamespaceFilteredData() {
    if (selectedNamespaces.size === 0) return [];
    return data.filter((row) => selectedNamespaces.has(row.namespace));
  }

  const table = createSvelteTable({
    get data() {
      return getNamespaceFilteredData();
    },
    get columns() {
      return columns;
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: (row) => `${row.uid}`,
    onSortingChange: (updater) => {
      sorting = typeof updater === "function" ? updater(sorting) : updater;
    },
    onColumnFiltersChange: (updater) => {
      columnFilters = typeof updater === "function" ? updater(columnFilters) : updater;
    },
    onColumnVisibilityChange: (updater) => {
      columnVisibility = typeof updater === "function" ? updater(columnVisibility) : updater;
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex: paginationPageIndex, pageSize: paginationPageSize })
          : updater;
      paginationPageIndex = next.pageIndex;
      paginationPageSize = next.pageSize;
    },
    state: {
      get pagination() {
        return { pageIndex: paginationPageIndex, pageSize: paginationPageSize };
      },
      get sorting() {
        return sorting;
      },
      get columnFilters() {
        return columnFilters;
      },
      get columnVisibility() {
        return columnVisibility;
      },
    },
  });
  const flatRows = $derived.by(() => table.getRowModel().rows);
  const flatVirtualWindow = $derived.by(() =>
    computeVirtualWindow({
      totalCount: flatRows.length,
      rowHeight: VIRTUAL_ROW_HEIGHT,
      viewportHeight: tableViewportHeight,
      scrollTop: tableScrollTop,
      overscan: 10,
    }),
  );
  const flatVisibleRows = $derived.by(() =>
    flatRows.slice(flatVirtualWindow.startIndex, flatVirtualWindow.endIndex),
  );

  function getGroupedRows() {
    if (viewMode === "flat") return [];
    const rows = table.getRowModel().rows;
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.original.namespace;
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    return [...groups.entries()];
  }

  function getGroupId(groupKey: string) {
    return `${viewMode}:${groupKey}`;
  }

  function isGroupCollapsed(groupKey: string) {
    return collapsedGroups.has(getGroupId(groupKey));
  }

  function toggleGroup(groupKey: string) {
    const id = getGroupId(groupKey);
    const next = new Set(collapsedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedGroups = next;
  }

  function getVisibleGroupKeys() {
    return getGroupedRows().map(([groupKey]) => groupKey);
  }

  function hasGroupedRows() {
    return viewMode !== "flat" && getVisibleGroupKeys().length > 0;
  }

  function getGroupSelectionState(groupRows: ReturnType<typeof getGroupedRows>[number][1]) {
    const selected = groupRows.filter((row) => isRowSelected(row.original)).length;
    return {
      checked: groupRows.length > 0 && selected === groupRows.length,
      indeterminate: selected > 0 && selected < groupRows.length,
    };
  }

  function toggleAllGroups() {
    const ids = getVisibleGroupKeys().map((groupKey) => getGroupId(groupKey));
    collapsedGroups = toggleAllGroupsCollapsed(collapsedGroups, ids);
  }

  function toCsvCell(value: unknown) {
    if (value === null || value === undefined) return "";
    const text = String(value).replaceAll('"', '""');
    return `"${text}"`;
  }

  async function downloadCsv() {
    const exportColumns = table
      .getVisibleLeafColumns()
      .filter((column) => !["problemScore", "select", "actions"].includes(column.id));
    const headers = exportColumns.map((column) =>
      typeof column.columnDef.header === "string" ? column.columnDef.header : column.id,
    );
    const lines = [headers.map(toCsvCell).join(",")];
    for (const row of table.getRowModel().rows) {
      const values = exportColumns.map((column) => row.getValue(column.id));
      lines.push(values.map(toCsvCell).join(","));
    }
    const csv = lines.join("\n");
    const result = await exportCsvArtifact({ filename: "stateful-sets.csv", csv });
    onCsvDownloaded({ pathHint: result.pathHint, rows: table.getRowModel().rows.length });
  }

  function getToggleableColumns() {
    return table
      .getAllLeafColumns()
      .filter((column) => !["problemScore", "select", "actions"].includes(column.id));
  }

  function getColumnLabel(column: ReturnType<typeof table.getAllLeafColumns>[number]) {
    return typeof column.columnDef.header === "string" ? column.columnDef.header : column.id;
  }

  function getColumnEntries() {
    return getToggleableColumns().map((column) => ({
      id: column.id,
      label: getColumnLabel(column),
      checked: column.getIsVisible(),
      disabled: column.getCanHide?.() === false,
    }));
  }

  function toggleColumnVisibility(columnId: string, checked: boolean) {
    table.getColumn(columnId)?.toggleVisibility(checked);
  }

  function showAllColumns() {
    for (const column of getToggleableColumns()) {
      column.toggleVisibility(true);
    }
  }

  function hideAllColumns() {
    for (const column of getToggleableColumns()) {
      if (column.getCanHide?.() === false) continue;
      column.toggleVisibility(false);
    }
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

  $effect(() => {
    viewMode;
    collapsedGroups = new Set<string>();
  });

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
      next.size !== selectedNamespaces.size ||
      [...next].some((namespace) => !selectedNamespaces.has(namespace));
    previousAvailableNamespaces = availableNamespaces;
    if (changed) {
      selectedNamespaces = next;
    }
  });
</script>

<TableToolbarShell>
  {#snippet children()}
    <Input
      placeholder="Filter stateful sets..."
      value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
      onchange={(e) => {
        table.getColumn("name")?.setFilterValue(e.currentTarget.value);
      }}
      oninput={(e) => {
        table.getColumn("name")?.setFilterValue(e.currentTarget.value);
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
    <Button
      variant="outline"
      size="sm"
      onclick={downloadCsv}
      title="Download CSV"
      aria-label="Download CSV"
    >
      <FileDown class="mr-1 h-4 w-4" />
      Download CSV
    </Button>
    <div class="flex items-center gap-1 rounded border bg-background p-1">
      <button
        type="button"
        class={`rounded p-1.5 ${viewMode === "flat" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        onclick={() => onViewModeChange("flat")}
        title="Flat list"
        aria-label="Flat list"
      >
        <List class="h-4 w-4" />
      </button>
      <button
        type="button"
        class={`rounded p-1.5 ${viewMode === "namespace" ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        onclick={() => onViewModeChange("namespace")}
        title="Group by namespace"
        aria-label="Group by namespace"
      >
        <Layers3 class="h-4 w-4" />
      </button>
    </div>
    <WatcherToolbarControls
      {watcherEnabled}
      {watcherRefreshSeconds}
      {onToggleWatcher}
      {onWatcherRefreshSecondsChange}
      {onResetWatcherSettings}
    />
    {#if hasGroupedRows()}
      <Button variant="outline" size="sm" onclick={() => toggleAllGroups()}>
        {getGroupCollapseToggleLabel(
          collapsedGroups,
          getVisibleGroupKeys().map((groupKey) => getGroupId(groupKey)),
        )}
      </Button>
    {/if}
  {/snippet}
</TableToolbarShell>

{#if watcherError}
  <div
    class="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
  >
    {watcherError}
  </div>
{/if}

<TableSurface onScroll={handleTableScroll}>
  <Table.Root>
    <Table.Caption>A list of stateful sets.</Table.Caption>
    <Table.Header>
      {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
        <Table.Row>
          {#each headerGroup.headers as header (header.id)}
            <Table.Head colspan={header.colSpan}>
              <TableHeaderCell {header} />
            </Table.Head>
          {/each}
        </Table.Row>
      {/each}
    </Table.Header>
    <Table.Body>
      {#if viewMode === "flat"}
        {#if flatRows.length === 0}
          <Table.Row>
            <Table.Cell colspan={columns.length} class="h-24 text-center">No results.</Table.Cell>
          </Table.Row>
        {:else}
          {#if flatVirtualWindow.paddingTop > 0}
            <Table.Row aria-hidden="true">
              <Table.Cell
                colspan={columns.length}
                class="p-0"
                style={`height:${flatVirtualWindow.paddingTop}px;`}
              />
            </Table.Row>
          {/if}
          {#each flatVisibleRows as row (row.id)}
            <Table.Row
              data-state={isRowSelected(row.original) ? "selected" : undefined}
              onclick={() => onRowClick?.(row.original)}
              class="cursor-pointer"
            >
              {#each row.getVisibleCells() as cell (cell.id)}
                <Table.Cell>
                  <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
                </Table.Cell>
              {/each}
            </Table.Row>
          {/each}
          {#if flatVirtualWindow.paddingBottom > 0}
            <Table.Row aria-hidden="true">
              <Table.Cell
                colspan={columns.length}
                class="p-0"
                style={`height:${flatVirtualWindow.paddingBottom}px;`}
              />
            </Table.Row>
          {/if}
        {/if}
      {:else}
        {#each getGroupedRows() as [groupKey, rows] (getGroupId(groupKey))}
          <Table.Row class="bg-muted/40">
            <Table.Cell colspan={columns.length} class="sticky-table-group-header">
              <div class="inline-flex items-center gap-2">
                <StatefulSetSelectionCheckbox
                  checked={getGroupSelectionState(rows).checked}
                  indeterminate={getGroupSelectionState(rows).indeterminate}
                  label={`Select namespace ${groupKey || "-"}`}
                  onToggle={(next) =>
                    onToggleGroupSelection(
                      groupKey,
                      next,
                      rows.map((row) => row.original.uid),
                    )}
                />
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted"
                  onclick={() => toggleGroup(groupKey)}
                  aria-label={isGroupCollapsed(groupKey) ? "Expand group" : "Collapse group"}
                  title={isGroupCollapsed(groupKey) ? "Expand group" : "Collapse group"}
                >
                  <ChevronDown
                    class={`h-4 w-4 transition-transform ${isGroupCollapsed(groupKey) ? "-rotate-90" : "rotate-0"}`}
                  />
                  <span>Namespace: {groupKey || "-"}</span>
                  <span class="opacity-80">({rows.length})</span>
                </button>
              </div>
            </Table.Cell>
          </Table.Row>
          {#if !isGroupCollapsed(groupKey)}
            {#each rows as row (row.id)}
              <Table.Row
                data-state={isRowSelected(row.original) ? "selected" : undefined}
                onclick={() => onRowClick?.(row.original)}
                class="cursor-pointer"
              >
                {#each row.getVisibleCells() as cell (cell.id)}
                  <Table.Cell>
                    <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
                  </Table.Cell>
                {/each}
              </Table.Row>
            {/each}
          {/if}
        {:else}
          <Table.Row>
            <Table.Cell colspan={columns.length} class="h-24 text-center">No results.</Table.Cell>
          </Table.Row>
        {/each}
      {/if}
    </Table.Body>
  </Table.Root>
</TableSurface>

<TablePagination
  currentPage={paginationPageIndex}
  totalPages={table.getPageCount()}
  totalRows={table.getRowCount()}
  pageSize={paginationPageSize}
  onPageChange={(p) => {
    paginationPageIndex = p;
    table.setPageIndex(p);
  }}
  onPageSizeChange={(s) => {
    paginationPageSize = s;
    paginationPageIndex = 0;
    table.setPageSize(s);
  }}
/>
