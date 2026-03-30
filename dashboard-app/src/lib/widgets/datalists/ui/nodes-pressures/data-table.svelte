<script lang="ts" generics="TData, TValue">
  import {
    type ColumnDef,
    type PaginationState,
    type SortingState,
    type ColumnFiltersState,
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
  import type { NodesPressuresData } from "./columns";
  import { problemsFilter } from "./problems-filter";
  import Pagination from "../pagination.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";

  type DataTableProps<NodesPressuresData> = {
    columns: ColumnDef<NodesPressuresData>[];
    data: NodesPressuresData[];
  };

  let { data, columns }: DataTableProps<NodesPressuresData> = $props();
  let pagination = $state<PaginationState>({ pageIndex: 0, pageSize: 15 });
  let paginationPageIndex = $state(0);
  let paginationPageSize = $state(100);
  let sorting = $state<SortingState>([]);
  let columnFilters = $state<ColumnFiltersState>([]);

  const table = createSvelteTable({
    get data() {
      return data;
    },
    getRowId: (row) => `${row.uid}`,
    get columns() {
      return columns;
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
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
    filterFns: {
      problems: problemsFilter,
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
    },
    initialState: {
      columnVisibility: {
        problems: false,
      },
    },
  });
</script>

<div class="flex flex-wrap items-end justify-between gap-3 py-3">
  <Input
    placeholder="Filter nodes..."
    value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
    onchange={(e) => {
      table.getColumn("name")?.setFilterValue(e.currentTarget.value);
    }}
    oninput={(e) => {
      table.getColumn("name")?.setFilterValue(e.currentTarget.value);
    }}
    class="w-full max-w-xl"
  />
  <Button
    variant="outline"
    size="sm"
    class="ml-auto"
    onclick={() => {
      columnFilters = columnFilters.length ? [] : [{ id: "problems", value: true }];
    }}>Filter problems</Button
  >
</div>
<TableSurface maxHeightClass="">
  <Table.Root>
    <Table.Caption>Nodes pressures.</Table.Caption>
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
        <Table.Row data-state={row.getIsSelected() && "selected"}>
          {#each row.getVisibleCells() as cell (cell.id)}
            <Table.Cell>
              <FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
            </Table.Cell>
          {/each}
        </Table.Row>
      {:else}
        <Table.Row>
          <Table.Cell colspan={columns.length} class="h-24 text-center">
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
