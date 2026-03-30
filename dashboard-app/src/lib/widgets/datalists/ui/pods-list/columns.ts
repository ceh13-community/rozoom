import type { ColumnDef } from "@tanstack/table-core";
import { createRawSnippet } from "svelte";
import { renderComponent, renderSnippet } from "$shared/ui/data-table";
import { SortingButton } from "$shared/ui/button";
import { getProblemTone, type ProblemSeverity } from "../model/problem-priority";
import PodActionsMenu from "./pod-actions-menu.svelte";
import PodSelectionCheckbox from "./pod-selection-checkbox.svelte";
import PodStatusBadge from "./pod-status-badge.svelte";

export type PodsListData = {
  age: string;
  ageSeconds: number;
  containers: {
    ready: boolean;
  }[];
  controlledBy: string;
  cpu: string;
  cpuMillicores: number;
  memory: string;
  memoryBytes: number;
  name: string;
  namespace: string;
  node: string;
  qos: string;
  restarts: number;
  restartsSeverity: ProblemSeverity;
  status: string;
  uid: string;
  cpuSeverity: ProblemSeverity;
  memorySeverity: ProblemSeverity;
  problemScore: number;
};

type PodsListColumnOptions = {
  isSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  areAllSelected: boolean;
  isSomeSelected: boolean;
  onToggleAll: () => void;
  onShowDetails: (pod: PodsListData) => void;
  onShell: (pod: PodsListData) => void;
  onAttach: (pod: PodsListData) => void;
  onEditYaml: (pod: PodsListData) => void;
  onInvestigate: (pod: PodsListData) => void;
  onCopyDescribe: (pod: PodsListData) => void;
  onRunDebugDescribe: (pod: PodsListData) => void;
  onCopyDebug: (pod: PodsListData) => void;
  onPreviousLogs: (pod: PodsListData) => void;
  onExportIncident: (pod: PodsListData) => void;
  onDownloadYaml: (pod: PodsListData) => void;
  onPortForward: (pod: PodsListData) => void;
  onEvict: (pod: PodsListData) => void;
  onLogs: (pod: PodsListData) => void;
  onDelete: (pod: PodsListData) => void;
  isDeleting: (id: string) => boolean;
  isEvicting: (id: string) => boolean;
  isYamlBusy: (id: string) => boolean;
  isExportingIncident: (id: string) => boolean;
  isDownloadingYaml: (id: string) => boolean;
};

export const createColumns = ({
  isSelected,
  onToggleSelect,
  areAllSelected,
  isSomeSelected,
  onToggleAll,
  onShell,
  onAttach,
  onEditYaml,
  onInvestigate,
  onCopyDescribe,
  onRunDebugDescribe,
  onCopyDebug,
  onPreviousLogs,
  onExportIncident,
  onDownloadYaml,
  onPortForward,
  onEvict,
  onLogs,
  onDelete,
  isDeleting,
  isEvicting,
  isYamlBusy,
  isExportingIncident,
  isDownloadingYaml,
}: PodsListColumnOptions): ColumnDef<PodsListData>[] => [
  {
    accessorFn: (row) => row.problemScore,
    id: "problemScore",
    header: "Problem",
    enableHiding: false,
    cell: () => "",
  },
  {
    id: "select",
    header: () => {
      return renderComponent(PodSelectionCheckbox, {
        checked: areAllSelected,
        indeterminate: isSomeSelected,
        label: "Select all pods",
        onToggle: () => {
          onToggleAll();
        },
      });
    },
    cell: ({ row }) => {
      return renderComponent(PodSelectionCheckbox, {
        checked: isSelected(row.original.uid),
        label: `Select pod ${row.original.name}`,
        onToggle: () => {
          onToggleSelect(row.original.uid);
        },
      });
    },
    enableSorting: false,
  },
  {
    id: "actions",
    header: () => {
      const actionsHeaderSnippet = createRawSnippet(() => ({
        render: () => `<div class="w-8"></div>`,
      }));
      return renderSnippet(actionsHeaderSnippet, {});
    },
    cell: ({ row }) => {
      return renderComponent(PodActionsMenu, {
        name: row.original.name,
        namespace: row.original.namespace,
        isDeleting: isDeleting(row.original.uid),
        isEvicting: isEvicting(row.original.uid),
        isYamlBusy: isYamlBusy(row.original.uid),
        isExportingIncident: isExportingIncident(row.original.uid),
        isDownloadingYaml: isDownloadingYaml(row.original.uid),
        onShell: () => {
          onShell(row.original);
        },
        onAttach: () => {
          onAttach(row.original);
        },
        onEditYaml: () => {
          onEditYaml(row.original);
        },
        onInvestigate: () => {
          onInvestigate(row.original);
        },
        onCopyDescribe: () => {
          onCopyDescribe(row.original);
        },
        onRunDebugDescribe: () => {
          onRunDebugDescribe(row.original);
        },
        onCopyDebug: () => {
          onCopyDebug(row.original);
        },
        onPreviousLogs: () => {
          onPreviousLogs(row.original);
        },
        onExportIncident: () => {
          onExportIncident(row.original);
        },
        onDownloadYaml: () => {
          onDownloadYaml(row.original);
        },
        onPortForward: () => {
          onPortForward(row.original);
        },
        onEvict: () => {
          onEvict(row.original);
        },
        onLogs: () => {
          onLogs(row.original);
        },
        onDelete: () => {
          onDelete(row.original);
        },
      });
    },
    enableSorting: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Name",
        onclick: column.getToggleSortingHandler(),
      });
    },
  },
  {
    accessorKey: "namespace",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Namespace",
        onclick: column.getToggleSortingHandler(),
      });
    },
    cell: ({ row }) => {
      const namespaceCellSnippet = createRawSnippet(() => ({
        render: () => `<div class="truncate">${row.original.namespace}</div>`,
      }));
      return renderSnippet(namespaceCellSnippet, {
        ns: row.original.namespace,
      });
    },
  },
  {
    accessorKey: "containers",
    header: "Containers",
    cell: ({ row }) => {
      const containersCellSnippet = createRawSnippet(() => {
        const total = row.original.containers.length;
        const ready = row.original.containers.filter((container) => container.ready).length;
        const dotClass =
          total === 0 ? "bg-slate-400" : ready === total ? "bg-green-500" : "bg-amber-400";
        const result = `<div class="flex items-center gap-2"><span class="inline-block h-2 w-2 rounded-full ${dotClass}"></span><span>${ready}/${total}</span></div>`;
        return { render: () => result };
      });
      return renderSnippet(containersCellSnippet, {
        containers: row.original.containers,
      });
    },
  },
  {
    accessorFn: (row) => row.cpuMillicores,
    id: "cpu",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "CPU",
        onclick: column.getToggleSortingHandler(),
      });
    },
    cell: ({ row }) => {
      const tone = getProblemTone(row.original.cpuSeverity);
      const cpuCellSnippet = createRawSnippet(() => ({
        render: () => `<span class="${tone.text}">${row.original.cpu}</span>`,
      }));
      return renderSnippet(cpuCellSnippet, {});
    },
  },
  {
    accessorFn: (row) => row.memoryBytes,
    id: "memory",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Memory",
        onclick: column.getToggleSortingHandler(),
      });
    },
    cell: ({ row }) => {
      const tone = getProblemTone(row.original.memorySeverity);
      const memoryCellSnippet = createRawSnippet(() => ({
        render: () => `<span class="${tone.text}">${row.original.memory}</span>`,
      }));
      return renderSnippet(memoryCellSnippet, {});
    },
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
      const tone = getProblemTone(row.original.restartsSeverity);
      const restartsCountSnippet = createRawSnippet(() => ({
        render: () => `<div class="text-center ${tone.text}">${row.original.restarts}</div>`,
      }));
      return renderSnippet(restartsCountSnippet, {
        restarts: row.original.restarts,
      });
    },
  },
  {
    accessorKey: "controlledBy",
    header: () => {
      const controlledBySnippet = createRawSnippet(() => ({
        render: () => `<div class="truncate">Controlled by</div>`,
      }));
      return renderSnippet(controlledBySnippet, {});
    },
  },
  {
    accessorKey: "node",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Node",
        onclick: column.getToggleSortingHandler(),
      });
    },
  },
  {
    accessorKey: "qos",
    header: "QoS",
  },
  {
    accessorFn: (row) => row.ageSeconds,
    id: "age",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Age",
        onclick: column.getToggleSortingHandler(),
      });
    },
    cell: ({ row }) => {
      const ageCellSnippet = createRawSnippet(() => ({
        render: () => `<div class="text-center">${row.original.age}</div>`,
      }));
      return renderSnippet(ageCellSnippet, {
        age: row.original.age,
      });
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => {
      return renderComponent(SortingButton, {
        label: "Status",
        onclick: column.getToggleSortingHandler(),
      });
    },
    cell: ({ row }) =>
      renderComponent(PodStatusBadge, {
        status: row.original.status,
      }),
  },
];
