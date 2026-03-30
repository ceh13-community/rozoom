import { timeAgo } from "$shared/lib/timeFormatters";
import type { ColumnDef } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderComponent, renderSnippet } from "$shared/ui/data-table";
import { SortingButton } from "$shared/ui/button";
import { getProblemTone, type ProblemSeverity } from "../model/problem-priority";
import NodeActionsMenu from "./node-actions-menu.svelte";
import NodeSelectionCheckbox from "./node-selection-checkbox.svelte";

export type NodesStatusesData = {
  age: Date;

  // We need to render "Updating…" and "-" states, so values can be null
  cpu: string | null;
  freeMemory: string | null;
  freeDisk: string | null;

  conditions: string;
  name: string;
  roles: string;
  taints: number;
  unschedulable: boolean;
  uid: string;
  version: string;

  // Per-row metrics UI state
  metricsLoading: boolean;
  metricsUpdatedAt: number | null;
  metricsError: string | null;
  cpuSeverity: ProblemSeverity;
  memorySeverity: ProblemSeverity;
  problemScore: number;
};

const compactSortingButtonClass =
  "h-8 max-w-full overflow-hidden px-2 py-1 text-xs [&>span]:truncate";

function renderMetric(
  value: string | null,
  metricsLoading: boolean,
  metricsError: string | null,
): string {
  if (metricsError) return "Error";
  if (metricsLoading) return "Updating…";
  if (!value) return "-";
  return value;
}

function renderCondition(condition: string): string {
  const parts = condition
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const items = parts.length > 0 ? parts : [condition];

  return `<div class="flex max-w-full flex-wrap gap-1.5">${items
    .map((item) => {
      const normalized = item.toLowerCase();
      const isReady = normalized.includes("ready") && !normalized.includes("not");
      const dotClass = isReady ? "bg-emerald-500" : "bg-rose-500";
      const tone = isReady
        ? "border-emerald-300/60 bg-emerald-100/40 text-emerald-700 dark:text-emerald-300"
        : "border-rose-300/60 bg-rose-100/40 text-rose-700 dark:text-rose-300";
      return `<span class="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs ${tone}"><span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}"></span><span class="truncate">${item}</span></span>`;
    })
    .join("")}</div>`;
}

type NodesStatusesColumnOptions = {
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  areAllSelected: boolean;
  isSomeSelected: boolean;
  onToggleAll: () => void;
  onShowDetails: (node: NodesStatusesData) => void;
  onTopNode: (node: NodesStatusesData) => void;
  onEvents: (node: NodesStatusesData) => void;
  onShell: (node: NodesStatusesData) => void;
  onToggleCordon: (node: NodesStatusesData) => void;
  onDrain: (node: NodesStatusesData) => void;
  onEditYaml: (node: NodesStatusesData) => void;
  onInvestigate?: (node: NodesStatusesData) => void;
  onCopyDescribe: (node: NodesStatusesData) => void;
  onRunDebugDescribe: (node: NodesStatusesData) => void;
  onDownloadYaml: (node: NodesStatusesData) => void;
  onDelete: (node: NodesStatusesData) => void;
  isCordoning: (uid: string) => boolean;
  isDraining: (uid: string) => boolean;
  isDeleting: (uid: string) => boolean;
};

export const createColumns = ({
  isSelected,
  onToggleSelect,
  areAllSelected,
  isSomeSelected,
  onToggleAll,
  onShowDetails,
  onTopNode,
  onEvents,
  onShell,
  onToggleCordon,
  onDrain,
  onEditYaml,
  onInvestigate,
  onCopyDescribe,
  onRunDebugDescribe,
  onDownloadYaml,
  onDelete,
  isCordoning,
  isDraining,
  isDeleting,
}: NodesStatusesColumnOptions): ColumnDef<NodesStatusesData>[] => [
  {
    accessorFn: (row) => row.problemScore,
    id: "problemScore",
    header: "Problem",
    enableHiding: false,
    cell: () => "",
  },
  {
    id: "select",
    header: () =>
      renderComponent(NodeSelectionCheckbox, {
        checked: areAllSelected,
        indeterminate: isSomeSelected,
        label: "Select all nodes",
        onToggle: () => {
          onToggleAll();
        },
      }),
    cell: ({ row }) =>
      renderComponent(NodeSelectionCheckbox, {
        checked: isSelected(row.original.uid),
        label: `Select node ${row.original.name}`,
        onToggle: () => {
          onToggleSelect(row.original.uid);
        },
      }),
    enableSorting: false,
    size: 40,
  },
  {
    id: "actions",
    header: () => {
      const actionsHeaderSnippet = createRawSnippet(() => ({
        render: () => `<div class="w-8"></div>`,
      }));
      return renderSnippet(actionsHeaderSnippet, {});
    },
    cell: ({ row }) =>
      renderComponent(NodeActionsMenu, {
        name: row.original.name,
        isUnschedulable: row.original.unschedulable,
        isCordoning: isCordoning(row.original.uid),
        isDraining: isDraining(row.original.uid),
        isDeleting: isDeleting(row.original.uid),
        onShowDetails: () => {
          onShowDetails(row.original);
        },
        onTopNode: () => {
          onTopNode(row.original);
        },
        onEvents: () => {
          onEvents(row.original);
        },
        onShell: () => {
          onShell(row.original);
        },
        onToggleCordon: () => {
          onToggleCordon(row.original);
        },
        onDrain: () => {
          onDrain(row.original);
        },
        onEditYaml: () => {
          onEditYaml(row.original);
        },
        onInvestigate: onInvestigate
          ? () => {
              onInvestigate(row.original);
            }
          : undefined,
        onCopyDescribe: () => {
          onCopyDescribe(row.original);
        },
        onRunDebugDescribe: () => {
          onRunDebugDescribe(row.original);
        },
        onDownloadYaml: () => {
          onDownloadYaml(row.original);
        },
        onDelete: () => {
          onDelete(row.original);
        },
      }),
    enableSorting: false,
    size: 50,
  },
  {
    accessorKey: "name",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "Name",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 300,
    maxSize: 500,
    minSize: 220,
    enableResizing: true,
    cell: ({ row }) => {
      const nameSnippet = createRawSnippet(() => ({
        render: () =>
          `<span class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title="${row.original.name}">${row.original.name}</span>`,
      }));
      return renderSnippet(nameSnippet, {});
    },
  },
  {
    accessorKey: "conditions",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "Conditions",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 220,
    minSize: 200,
    cell: ({ row }) => {
      const conditionSnippet = createRawSnippet(() => ({
        render: () => renderCondition(row.original.conditions),
      }));
      return renderSnippet(conditionSnippet, {});
    },
  },
  {
    accessorKey: "taints",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "Taints",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 160,
  },
  {
    accessorKey: "roles",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "Roles",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 220,
    minSize: 160,
    cell: ({ row }) => {
      const roles = row.original.roles || "-";
      const rolesSnippet = createRawSnippet(() => ({
        render: () =>
          `<span class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title="${roles}">${roles}</span>`,
      }));
      return renderSnippet(rolesSnippet, {});
    },
  },
  {
    accessorKey: "version",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "Version",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 170,
    minSize: 130,
    cell: ({ row }) => {
      const versionSnippet = createRawSnippet(() => ({
        render: () =>
          `<span class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title="${row.original.version}">${row.original.version}</span>`,
      }));
      return renderSnippet(versionSnippet, {});
    },
  },
  {
    accessorFn: (row) => row.age.getTime(),
    id: "age",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "Age",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    cell: ({ row }) => {
      const ageSnippet = createRawSnippet(() => {
        const seconds = Math.floor((Date.now() - row.original.age.getTime()) / 1000);
        return { render: () => (seconds < 60 ? "just now" : timeAgo(row.original.age)) };
      });
      return renderSnippet(ageSnippet, {});
    },
  },
  {
    accessorKey: "cpu",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "CPU",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 110,
    minSize: 90,
    cell: ({ row }) => {
      const value = renderMetric(
        row.original.cpu,
        row.original.metricsLoading,
        row.original.metricsError,
      );
      const tone = getProblemTone(row.original.cpuSeverity);
      const cpuSnippet = createRawSnippet(() => ({
        render: () => `<span class="${tone.text}">${value}</span>`,
      }));
      return renderSnippet(cpuSnippet, {});
    },
  },
  {
    accessorKey: "freeMemory",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "FreeMem",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 130,
    minSize: 110,
    cell: ({ row }) => {
      const value = renderMetric(
        row.original.freeMemory,
        row.original.metricsLoading,
        row.original.metricsError,
      );
      const tone = getProblemTone(row.original.memorySeverity);
      const memSnippet = createRawSnippet(() => ({
        render: () =>
          `<span class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap ${tone.text}" title="${value}">${value}</span>`,
      }));
      return renderSnippet(memSnippet, {});
    },
  },
  {
    accessorKey: "freeDisk",
    header: ({ column }) =>
      renderComponent(SortingButton, {
        label: "FreeDisk",
        onclick: column.getToggleSortingHandler(),
        class: compactSortingButtonClass,
      }),
    size: 130,
    minSize: 110,
    cell: ({ row }) => {
      const value = renderMetric(
        row.original.freeDisk,
        row.original.metricsLoading,
        row.original.metricsError,
      );
      const diskSnippet = createRawSnippet(() => ({
        render: () =>
          `<span class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap" title="${value}">${value}</span>`,
      }));
      return renderSnippet(diskSnippet, {});
    },
  },
];
