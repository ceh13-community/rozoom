<script lang="ts">
  import Bug from "@lucide/svelte/icons/bug";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Info from "@lucide/svelte/icons/info";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Trash from "@lucide/svelte/icons/trash";
  import WorkloadBulkActions from "../common/workload-bulk-actions.svelte";

  type ConfigurationBulkActionsProps = {
    mode: "single" | "multi";
    disabled?: boolean;
    onShowDetails: () => void;
    onEditYaml: () => void;
    onCopyKubectlGetYaml: () => void;
    onCopyKubectlDescribe: () => void;
    onRunDebugDescribe?: () => void;
    onPortForward?: () => void;
    onDelete: () => void;
  };

  const {
    mode,
    disabled = true,
    onShowDetails,
    onEditYaml,
    onCopyKubectlGetYaml,
    onCopyKubectlDescribe,
    onRunDebugDescribe,
    onPortForward,
    onDelete,
  }: ConfigurationBulkActionsProps = $props();
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
      id: "edit-yaml",
      icon: Pencil,
      label: "Edit YAML",
      title: "Edit YAML",
      onClick: onEditYaml,
      showInModes: ["single"],
    },
    {
      id: "copy-kubectl",
      icon: Copy,
      label: "Copy kubectl YAML",
      title: "Copy kubectl get -o yaml",
      onClick: onCopyKubectlGetYaml,
      showInModes: ["single"],
    },
    {
      id: "copy-kubectl-describe",
      icon: Copy,
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
    ...(onPortForward
      ? [
          {
            id: "port-forward",
            icon: Link2,
            label: "Port-forward preview",
            title: "Port-forward preview",
            onClick: onPortForward,
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
