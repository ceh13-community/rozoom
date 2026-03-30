import { createRawSnippet } from "svelte";
import type { ColumnDef } from "@tanstack/table-core";
import { renderComponent, renderSnippet } from "$shared/ui/data-table";
import { SortingButton } from "$shared/ui/button";
import { problemsFilter } from "./problems-filter";

export type NodesPressuresData = {
  age: string;
  diskPressure: string;
  memoryPressure: string;
  name: string;
  networkUnavailable: string;
  ready: string;
  pidPressure: string;
  role: string;
  uid: string;
};

const statusDecorated = (status: string, inverse = false) => {
  if (status === "True" || (inverse && status === "False")) {
    return `<span class="text-green-600">✅${status}</span>`;
  } else if (status === "False" || (inverse && status === "True")) {
    return `<span class="text-red-600">❌${status}</span>`;
  } else {
    return status;
  }
};

export const columns: ColumnDef<NodesPressuresData>[] = [
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "ready",
    header: "Ready",
    cell: ({ row }) => {
      const readyStatusSnippet = createRawSnippet(() => ({
        render: () => `<div class="text-left">${statusDecorated(row.original.ready)}</div>`,
      }));
      return renderSnippet(readyStatusSnippet, {
        ready: row.original.ready,
      });
    },
    enableGlobalFilter: true,
  },
  {
    accessorKey: "diskPressure",
    header: "DiskPressure",
    cell: ({ row }) => {
      const dpStatusSnippet = createRawSnippet(() => ({
        render: () =>
          `<div class="text-left">${statusDecorated(row.original.diskPressure, true)}</div>`,
      }));
      return renderSnippet(dpStatusSnippet, {
        diskPressure: row.original.diskPressure,
      });
    },
    enableGlobalFilter: true,
  },
  {
    accessorKey: "networkUnavailable",
    header: "NetworkUnavailable",
    cell: ({ row }) => {
      const nuStatusSnippet = createRawSnippet(() => ({
        render: () =>
          `<div class="text-left">${statusDecorated(row.original.networkUnavailable, true)}</div>`,
      }));
      return renderSnippet(nuStatusSnippet, {
        networkUnavailable: row.original.networkUnavailable,
      });
    },
    enableGlobalFilter: true,
  },
  {
    accessorKey: "pidPressure",
    header: "PIDPressure",
    cell: ({ row }) => {
      const ppStatusSnippet = createRawSnippet(() => ({
        render: () =>
          `<div class="text-left">${statusDecorated(row.original.pidPressure, true)}</div>`,
      }));
      return renderSnippet(ppStatusSnippet, {
        pidPressure: row.original.pidPressure,
      });
    },
    enableGlobalFilter: true,
  },
  {
    accessorKey: "memoryPressure",
    header: "MemoryPressure",
    cell: ({ row }) => {
      const mpStatusSnippet = createRawSnippet(() => ({
        render: () =>
          `<div class="text-left">${statusDecorated(row.original.memoryPressure, true)}</div>`,
      }));
      return renderSnippet(mpStatusSnippet, {
        memoryPressure: row.original.memoryPressure,
      });
    },
    enableGlobalFilter: true,
  },
  {
    accessorKey: "role",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Role",
        onclick: column.getToggleSortingHandler(),
      });
    },
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
  {
    id: "problems",
    accessorFn: () => "",
    filterFn: problemsFilter,
    enableSorting: false,
    enableHiding: true,
    enableColumnFilter: true,
  },
];
