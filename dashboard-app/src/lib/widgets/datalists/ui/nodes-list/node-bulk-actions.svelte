<script lang="ts">
  import Activity from "@lucide/svelte/icons/activity";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import Search from "@lucide/svelte/icons/search";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash from "@lucide/svelte/icons/trash";
  import UserX from "@lucide/svelte/icons/user-x";
  import WorkloadBulkActions from "../common/workload-bulk-actions.svelte";

  type NodeBulkActionsProps = {
    mode: "single" | "multi";
    canOpenShell: boolean;
    canEditYaml: boolean;
    isCordoning: boolean;
    isDraining: boolean;
    isDeleting: boolean;
    isUnschedulableSelection: boolean;
    onTopNode: () => void;
    onEvents: () => void;
    onShell: () => void;
    onToggleCordon: () => void;
    onDrain: () => void;
    onEditYaml: () => void;
    onInvestigate?: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onDownloadYaml?: () => void;
    onDelete: () => void;
  };

  const {
    mode,
    canOpenShell,
    canEditYaml,
    isCordoning,
    isDraining,
    isDeleting,
    isUnschedulableSelection,
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
  }: NodeBulkActionsProps = $props();
</script>

<WorkloadBulkActions
  {mode}
  disabled={false}
  items={[
    {
      id: "top-node",
      icon: Activity,
      label: "Top node",
      title: "Top node",
      onClick: onTopNode,
      showInModes: ["single"],
    },
    {
      id: "events",
      icon: Clock3,
      label: "Events",
      title: "Events",
      onClick: onEvents,
      showInModes: ["single"],
    },
    {
      id: "shell",
      icon: Terminal,
      label: "Shell",
      title: "Shell",
      onClick: onShell,
      showInModes: ["single"],
      disabled: !canOpenShell,
    },
    {
      id: "toggle-cordon",
      icon: UserX,
      label: isUnschedulableSelection ? "Uncordon selected nodes" : "Cordon selected nodes",
      title: isUnschedulableSelection ? "Uncordon" : "Cordon",
      onClick: onToggleCordon,
      disabled: isCordoning,
    },
    {
      id: "drain",
      icon: Plug,
      label: "Drain selected nodes",
      title: "Drain",
      onClick: onDrain,
      disabled: isDraining,
    },
    {
      id: "edit-yaml",
      icon: Pencil,
      label: "Edit YAML",
      title: "Edit YAML",
      onClick: onEditYaml,
      showInModes: ["single"],
      disabled: !canEditYaml,
    },
    ...(onInvestigate
      ? [
          {
            id: "investigate",
            icon: Search,
            label: "Investigate",
            title: "Investigate",
            onClick: onInvestigate,
            showInModes: ["single"] as ("single" | "multi")[],
          },
        ]
      : []),
    ...(onCopyDescribe
      ? [
          {
            id: "copy-describe",
            icon: ClipboardList,
            label: "Copy kubectl describe",
            title: "Copy describe",
            onClick: onCopyDescribe,
            showInModes: ["single"] as ("single" | "multi")[],
          },
        ]
      : []),
    ...(onRunDebugDescribe
      ? [
          {
            id: "debug-describe",
            icon: Bug,
            label: "Run debug describe",
            title: "Debug describe",
            onClick: onRunDebugDescribe,
            showInModes: ["single"] as ("single" | "multi")[],
          },
        ]
      : []),
    ...(onDownloadYaml
      ? [
          {
            id: "download-yaml",
            icon: FileDown,
            label: "Download YAML",
            title: "Download YAML",
            onClick: onDownloadYaml,
            showInModes: ["single"] as ("single" | "multi")[],
          },
        ]
      : []),
    {
      id: "delete",
      icon: Trash,
      label: "Delete selected nodes",
      title: "Delete",
      onClick: onDelete,
      destructive: true,
      disabled: isDeleting,
    },
  ]}
/>
