<script lang="ts" generics="TData extends NodesStatusesData, TValue">
  import {
    type ColumnDef,
    type PaginationState,
    type SortingState,
    type ColumnFiltersState,
    type VisibilityState,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel,
  } from "@tanstack/table-core";
  import { createSvelteTable, FlexRender, TableHeaderCell } from "$shared/ui/data-table/index.js";
  import * as Table from "$shared/ui/table/index.js";
  import { Button } from "$shared/ui/button";
  import TablePagination from "$shared/ui/table-pagination.svelte";
  import { Input } from "$shared/ui/input";
  import FileDown from "@lucide/svelte/icons/file-down";
  import type { NodesStatusesData } from "./columns";
  import TableChecklistDropdown from "../table-checklist-dropdown.svelte";
  import TableToolbarShell from "../table-toolbar-shell.svelte";
  import WatcherToolbarControls from "../watcher-toolbar-controls.svelte";
  import Pagination from "../pagination.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import { exportCsvArtifact } from "$shared/lib/text-export";

  type DataTableProps<T extends NodesStatusesData> = {
    columns: ColumnDef<T>[];
    data: T[];
    onRowClick?: (row: T) => void;
    watcherEnabled: boolean;
    watcherRefreshSeconds: number;
    watcherError: string | null;
    onToggleWatcher: () => void;
    onWatcherRefreshSecondsChange: (value: number) => void;
    onResetWatcherSettings: () => void;
    onCsvDownloaded?: (payload: { pathHint: string; rows: number }) => void;
  };

  let {
    data,
    columns,
    onRowClick,
    watcherEnabled,
    watcherRefreshSeconds,
    watcherError,
    onToggleWatcher,
    onWatcherRefreshSecondsChange,
    onResetWatcherSettings,
    onCsvDownloaded,
  }: DataTableProps<TData> = $props();

  let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 15 });
  let paginationPageIndex = $state(0);
  let paginationPageSize = $state(100);
  let sorting = $state<SortingState>([{ id: "problemScore", desc: true }]);
  let columnFilters = $state<ColumnFiltersState>([]);
  let columnVisibility = $state<VisibilityState>({ problemScore: false });

  const table = createSvelteTable({
    get data() {
      return data;
    },
    getRowId: (row) => `${row.uid}`,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    get columns() {
      return columns;
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: (updater) => {
      sorting = typeof updater === "function" ? updater(sorting) : updater;
    },
    onPaginationChange: (updater) => {
      pagination = typeof updater === "function" ? updater(pagination) : updater;
    },
    onColumnFiltersChange: (updater) => {
      columnFilters = typeof updater === "function" ? updater(columnFilters) : updater;
    },
    onColumnVisibilityChange: (updater) => {
      columnVisibility = typeof updater === "function" ? updater(columnVisibility) : updater;
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
    const filename = "nodes-status.csv";
    const result = await exportCsvArtifact({ filename, csv });
    onCsvDownloaded?.({ pathHint: result.pathHint, rows: table.getRowModel().rows.length });
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
</script>

<TableToolbarShell>
  {#snippet children()}
    <Input
      placeholder="Filter nodes by name..."
      value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
      oninput={(e) => table.getColumn("name")?.setFilterValue(e.currentTarget.value)}
      class="w-full max-w-xl"
    />
  {/snippet}
  {#snippet actions()}
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
    <WatcherToolbarControls
      {watcherEnabled}
      {watcherRefreshSeconds}
      {onToggleWatcher}
      {onWatcherRefreshSecondsChange}
      {onResetWatcherSettings}
    />
  {/snippet}
</TableToolbarShell>
{#if watcherError}
  <div
    class="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800"
  >
    {watcherError}
  </div>
{/if}

<TableSurface
  maxHeightClass=""
  surfaceClass="nodes-k9s-table-surface rounded-lg border border-border/60 bg-background/40"
>
  <Table.Root class="nodes-k9s-table">
    <Table.Caption>Nodes statuses.</Table.Caption>

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
      {#each table.getRowModel().rows as row (row.id)}
        <Table.Row
          data-state={row.getIsSelected() && "selected"}
          onclick={() => onRowClick?.(row.original)}
          class={onRowClick ? "cursor-pointer" : undefined}
        >
          {#each row.getVisibleCells() as cell (cell.id)}
            <Table.Cell>
              <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
            </Table.Cell>
          {/each}
        </Table.Row>
      {:else}
        <Table.Row>
          <Table.Cell colspan={table.getVisibleLeafColumns().length} class="h-24 text-center">
            <TableEmptyState message="No results for the current filter." />
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>

  {#if table.getPageCount() > 1}
    <Pagination
      getCanNextPage={table.getCanNextPage()}
      getCanPreviousPage={table.getCanPreviousPage()}
      nextPage={table.nextPage}
      previousPage={table.previousPage}
    />
  {/if}
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
