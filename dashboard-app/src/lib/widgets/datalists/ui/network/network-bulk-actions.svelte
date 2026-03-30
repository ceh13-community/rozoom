<script lang="ts">
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import Info from "@lucide/svelte/icons/info";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Trash from "@lucide/svelte/icons/trash";
  import WorkloadBulkActions from "../common/workload-bulk-actions.svelte";

  type Props = {
    mode: "single" | "multi";
    disabled?: boolean;
    showOpenWeb?: boolean;
    onShowDetails: () => void;
    onOpenWeb?: () => void;
    onCopyKubectlGetYaml: () => void;
    onCopyKubectlDescribe: () => void;
    onRunDebugDescribe?: () => void;
    onDelete: () => void;
  };

  const {
    mode,
    disabled = true,
    showOpenWeb = false,
    onShowDetails,
    onOpenWeb,
    onCopyKubectlGetYaml,
    onCopyKubectlDescribe,
    onRunDebugDescribe,
    onDelete,
  }: Props = $props();
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
      id: "copy-yaml",
      icon: Copy,
      label: "Copy kubectl YAML",
      title: "Copy kubectl get -o yaml",
      onClick: onCopyKubectlGetYaml,
      showInModes: ["single"],
    },
    {
      id: "copy-describe",
      icon: ClipboardList,
      label: "Copy describe",
      title: "Copy kubectl describe",
      onClick: onCopyKubectlDescribe,
      showInModes: ["single"],
    },
    ...(onRunDebugDescribe
      ? [
          {
            id: "run-debug-describe",
            icon: Bug,
            label: "Run debug describe",
            title: "Run debug describe",
            onClick: onRunDebugDescribe,
            showInModes: ["single"] as ("single" | "multi")[],
          },
        ]
      : []),
    ...(showOpenWeb && onOpenWeb
      ? [
          {
            id: "open-web",
            icon: Link2,
            label: "Open web tool",
            title: "Open web tool",
            onClick: onOpenWeb,
            showInModes: ["single"] as ("single" | "multi")[],
          },
        ]
      : []),
    {
      id: "delete",
      icon: Trash,
      label: "Delete resources",
      title: "Delete",
      onClick: onDelete,
      destructive: true,
    },
  ]}
/>
