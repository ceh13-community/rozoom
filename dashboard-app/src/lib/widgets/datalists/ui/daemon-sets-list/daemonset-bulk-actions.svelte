<script lang="ts">
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import WorkloadBulkActions from "../common/workload-bulk-actions.svelte";

  type DaemonSetBulkActionsProps = {
    mode: "single" | "multi";
    disabled?: boolean;
    onShowDetails: () => void;
    onLogs: () => void;
    onEvents: () => void;
    onEditYaml: () => void;
    onInvestigate: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onDownloadYaml: () => void;
    onRolloutStatus: () => void;
    onRolloutHistory: () => void;
    onRestart: () => void;
    onDelete: () => void;
  };

  const {
    mode,
    disabled = true,
    onShowDetails,
    onLogs,
    onEvents,
    onEditYaml,
    onInvestigate,
    onCopyDescribe = () => {},
    onRunDebugDescribe = () => {},
    onDownloadYaml,
    onRolloutStatus,
    onRolloutHistory,
    onRestart,
    onDelete,
  }: DaemonSetBulkActionsProps = $props();
</script>

<WorkloadBulkActions
  {mode}
  {disabled}
  items={[
    {
      id: "details",
      icon: Info,
      label: "Show details",
      title: "Show details",
      onClick: onShowDetails,
      showInModes: ["single"],
    },
    {
      id: "logs",
      icon: ScrollText,
      label: "Logs",
      title: "Logs",
      onClick: onLogs,
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
      id: "edit-yaml",
      icon: Pencil,
      label: "Edit YAML",
      title: "Edit YAML",
      onClick: onEditYaml,
      showInModes: ["single"],
    },
    {
      id: "investigate",
      icon: Search,
      label: "Investigate daemon set",
      title: "Investigate",
      onClick: onInvestigate,
      showInModes: ["single"],
    },
    {
      id: "copy-describe",
      icon: ClipboardList,
      label: "Copy describe",
      title: "Copy kubectl describe",
      onClick: onCopyDescribe,
      showInModes: ["single"],
    },
    {
      id: "run-debug-describe",
      icon: Bug,
      label: "Run debug describe",
      title: "Run debug describe",
      onClick: onRunDebugDescribe,
      showInModes: ["single"],
    },
    {
      id: "download-yaml",
      icon: FileDown,
      label: "Download YAML",
      title: "Download YAML",
      onClick: onDownloadYaml,
    },
    {
      id: "rollout-restart",
      icon: RotateCcw,
      label: "Rollout restart",
      title: "Rollout restart",
      onClick: onRestart,
    },
    {
      id: "rollout-status",
      icon: Clock3,
      label: "Rollout status",
      title: "Rollout status",
      onClick: onRolloutStatus,
      showInModes: ["single"],
    },
    {
      id: "rollout-history",
      icon: ListTree,
      label: "Rollout history",
      title: "Rollout history",
      onClick: onRolloutHistory,
      showInModes: ["single"],
    },
    {
      id: "delete",
      icon: Trash,
      label: "Delete daemon sets",
      title: "Delete",
      onClick: onDelete,
      destructive: true,
    },
  ]}
/>
