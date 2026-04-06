<script lang="ts">
  import { Trash } from "$shared/ui/icons";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import Search from "@lucide/svelte/icons/search";
  import WorkloadBulkActions from "../common/workload-bulk-actions.svelte";

  type DeploymentBulkActionsProps = {
    mode: "single" | "multi";
    disabled?: boolean;
    onShowDetails: () => void;
    onLogs: () => void;
    onEvents: () => void;
    onEditYaml: () => void;
    onInvestigate: () => void;
    onScale: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onRolloutStatus: () => void;
    onRolloutHistory: () => void;
    onDownloadYaml: () => void;
    onRestart: () => void;
    onPause: () => void;
    onResume: () => void;
    onUndo: () => void;
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
    onScale,
    onCopyDescribe = () => {},
    onRunDebugDescribe = () => {},
    onRolloutStatus,
    onRolloutHistory,
    onDownloadYaml,
    onRestart,
    onPause,
    onResume,
    onUndo,
    onDelete,
  }: DeploymentBulkActionsProps = $props();
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
      label: "Investigate deployment",
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
      id: "scale",
      icon: ArrowUpDown,
      label: "Scale",
      title: "Scale deployment",
      onClick: onScale,
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
      id: "rollout-restart",
      icon: RotateCcw,
      label: "Rollout restart",
      title: "Rollout restart",
      onClick: onRestart,
    },
    {
      id: "rollout-pause",
      icon: Pause,
      label: "Pause rollout",
      title: "Pause rollout",
      onClick: onPause,
    },
    {
      id: "rollout-resume",
      icon: Play,
      label: "Resume rollout",
      title: "Resume rollout",
      onClick: onResume,
    },
    {
      id: "undo-revision",
      icon: Undo2,
      label: "Undo revision",
      title: "Undo revision",
      onClick: onUndo,
    },
    {
      id: "delete",
      icon: Trash,
      label: "Delete deployments",
      title: "Delete",
      onClick: onDelete,
      destructive: true,
    },
  ]}
/>
