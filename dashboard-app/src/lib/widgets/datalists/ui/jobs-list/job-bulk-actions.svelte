<script lang="ts">
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import Pencil from "@lucide/svelte/icons/pencil";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import WorkloadBulkActions from "../common/workload-bulk-actions.svelte";

  type JobBulkActionsProps = {
    mode: "single" | "multi";
    disabled?: boolean;
    onShowDetails: () => void;
    onLogs: () => void;
    onEditYaml: () => void;
    onInvestigate: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onDownloadYaml: () => void;
    onDelete: () => void;
  };

  const {
    mode,
    disabled = true,
    onShowDetails,
    onLogs,
    onEditYaml,
    onInvestigate,
    onCopyDescribe = () => {},
    onRunDebugDescribe = () => {},
    onDownloadYaml,
    onDelete,
  }: JobBulkActionsProps = $props();
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
      label: "Investigate job",
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
      id: "delete",
      icon: Trash,
      label: "Delete jobs",
      title: "Delete",
      onClick: onDelete,
      destructive: true,
    },
  ]}
/>
