<script lang="ts" generics="TData">
  import {
    type ColumnDef,
    type PaginationState,
    type SortingState,
    type ColumnFiltersState,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
  } from "@tanstack/table-core";
  import { createSvelteTable, FlexRender, TableHeaderCell } from "$shared/ui/data-table/index.js";
  import * as Table from "$shared/ui/table/index.js";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import { Input } from "$shared/ui/input";
  import Pagination from "./pagination.svelte";

  type DataTableProps<TData> = {
    columns: ColumnDef<TData>[];
    data: TData[];
    filterColumnId?: string;
    filterPlaceholder?: string;
    onRowClick?: (row: TData) => void;
  };

  let {
    data,
    columns,
    filterColumnId = "name",
    filterPlaceholder = "Filter...",
    onRowClick,
  }: DataTableProps<TData> = $props();

  let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 15 });
  let sorting = $state<SortingState>([]);
  let columnFilters = $state<ColumnFiltersState>([]);

  const table = createSvelteTable({
    get data() {
      return data;
    },
    get columns() {
      return columns;
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => `${(row as { uid?: string }).uid ?? ""}`,
    onSortingChange: (updater) => {
      if (typeof updater === "function") {
        sorting = updater(sorting);
      } else {
        sorting = updater;
      }
    },
    onPaginationChange: (updater) => {
      if (typeof updater === "function") {
        pagination = updater(pagination);
      } else {
        pagination = updater;
      }
    },
    onColumnFiltersChange: (updater) => {
      if (typeof updater === "function") {
        columnFilters = updater(columnFilters);
      } else {
        columnFilters = updater;
      }
    },
    state: {
      get pagination() {
        return pagination;
      },
      get sorting() {
        return sorting;
      },
      get columnFilters() {
        return columnFilters;
      },
    },
  });

  $effect(() => {
    if (filterColumnId && !table.getColumn(filterColumnId) && data.length) {
      // Keep default filterColumnId but avoid throwing when columns differ.
      filterColumnId = "";
    }
  });
</script>

{#if filterColumnId}
  <div class="flex items-center py-4">
    <Input
      placeholder={filterPlaceholder}
      value={(table.getColumn(filterColumnId)?.getFilterValue() as string) ?? ""}
      onchange={(e) => {
        table.getColumn(filterColumnId)?.setFilterValue(e.currentTarget.value);
      }}
      oninput={(e) => {
        table.getColumn(filterColumnId)?.setFilterValue(e.currentTarget.value);
      }}
      class="max-w-sm"
    />
  </div>
{/if}
<div class="grid w-full grid-cols-1 overflow-visible">
  <TableSurface>
    <Table.Root>
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
            <Table.Cell colspan={columns.length} class="h-24 text-center">No results.</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </TableSurface>
  {#if table.getPageCount() > 1}
    <Pagination
      getCanNextPage={table.getCanNextPage()}
      getCanPreviousPage={table.getCanPreviousPage()}
      nextPage={table.nextPage}
      previousPage={table.previousPage}
    />
  {/if}
</div>
