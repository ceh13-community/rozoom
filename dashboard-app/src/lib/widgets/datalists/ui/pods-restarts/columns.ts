import type { ColumnDef } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderComponent, renderSnippet } from "$shared/ui/data-table";
import { SortingButton } from "$shared/ui/button";
export type PodRestartsData = {
  age: string;
  container: string;
  delta10m: number;
  namespace: string;
  pod: string;
  reason: string;
  restarts: number;
  status: string;
};

export const columns: ColumnDef<PodRestartsData>[] = [
  {
    accessorKey: "namespace",
    header: () => {
      const namespaceHeaderSnippet = createRawSnippet(() => ({
        render: () => `<div class="">Namespace</div>`,
      }));
      return renderSnippet(namespaceHeaderSnippet, {});
    },
    cell: ({ row }) => {
      const amountCellSnippet = createRawSnippet(() => ({
        render: () => `<div class="truncate">${row.original.namespace}</div>`,
      }));
      return renderSnippet(amountCellSnippet, {
        ns: row.original.namespace,
      });
    },
  },
  {
    accessorKey: "pod",
    header: "Pod",
  },
  {
    accessorKey: "container",
    header: "Container",
  },
  {
    accessorKey: "restarts",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Restarts",
        onclick: column.getToggleSortingHandler(),
      });
    },
    cell: ({ row }) => {
      const restartsCountSnippet = createRawSnippet(() => ({
        render: () => `<div class="text-center">${row.original.restarts}</div>`,
      }));
      return renderSnippet(restartsCountSnippet, {
        restarts: row.original.restarts,
      });
    },
  },
  {
    accessorKey: "delta10m",
    header: "Δ10m",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const statusCellSnippet = createRawSnippet(() => ({
        render: () => `<div class="whitespace-nowrap">${row.original.status}</div>`,
      }));
      return renderSnippet(statusCellSnippet, {
        status: row.original.status,
      });
    },
  },
  {
    accessorKey: "reason",
    header: "Reason",
    // cell: ({ row }) => {

    // }
  },
  {
    accessorKey: "age",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Age",
        onclick: column.getToggleSortingHandler(),
      });
    },
  },
];
