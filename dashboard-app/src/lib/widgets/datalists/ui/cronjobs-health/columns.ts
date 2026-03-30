import type { ColumnDef } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderSnippet } from "$shared/ui/data-table";
import { STATUS_CLASSES } from "$entities/cluster";

export type CronJobsHealthData = {
  namespace: string;
  name: string;
  schedule: string;
  lastScheduleTime: string;
  status: string;
  reason: string;
};

const statusClassMap: Record<string, string> = {
  ok: STATUS_CLASSES.ok,
  warning: STATUS_CLASSES.warning,
  critical: STATUS_CLASSES.error,
  unknown: STATUS_CLASSES.warning,
};

export const columns: ColumnDef<CronJobsHealthData>[] = [
  {
    accessorKey: "namespace",
    header: "Namespace",
    cell: ({ row }) => {
      const namespaceCell = createRawSnippet(() => ({
        render: () => `<div class="truncate">${row.original.namespace}</div>`,
      }));
      return renderSnippet(namespaceCell, {});
    },
  },
  {
    accessorKey: "name",
    header: "CronJob",
    cell: ({ row }) => {
      const nameCell = createRawSnippet(() => ({
        render: () => `<div class="truncate">${row.original.name}</div>`,
      }));
      return renderSnippet(nameCell, {});
    },
  },
  {
    accessorKey: "schedule",
    header: "Schedule",
  },
  {
    accessorKey: "lastScheduleTime",
    header: "Last Schedule",
    cell: ({ row }) => {
      const lastScheduleCell = createRawSnippet(() => ({
        render: () => `<div class="whitespace-nowrap">${row.original.lastScheduleTime}</div>`,
      }));
      return renderSnippet(lastScheduleCell, {});
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status.toLowerCase();
      const statusCell = createRawSnippet(() => ({
        render: () =>
          `<span class="rounded-md border px-2 py-0.5 text-xs font-semibold ${statusClassMap[status] ?? STATUS_CLASSES.warning}">${row.original.status}</span>`,
      }));
      return renderSnippet(statusCell, {});
    },
  },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ row }) => {
      const reasonCell = createRawSnippet(() => ({
        render: () => `<div class="max-w-[280px] truncate">${row.original.reason}</div>`,
      }));
      return renderSnippet(reasonCell, {});
    },
  },
];
