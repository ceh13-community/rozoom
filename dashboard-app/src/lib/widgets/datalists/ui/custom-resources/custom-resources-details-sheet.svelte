<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import FolderSearch from "@lucide/svelte/icons/folder-search";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import type { CustomResourceRow } from "./model/custom-resources-row-adapter";
  import DetailsSheetHeader from "../common/details-sheet-header.svelte";
  import DetailsMetadataGrid from "../common/details-metadata-grid.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";

  interface Props {
    row: CustomResourceRow | null;
    isOpen: boolean;
    onClose: () => void;
    onOpenYaml: (row: CustomResourceRow) => void;
    onCopyKubectlGetYaml: (row: CustomResourceRow) => void;
    onCopyKubectlDescribe: (row: CustomResourceRow) => void;
    onRunDebugDescribe: (row: CustomResourceRow) => void;
    onInvestigate?: (row: CustomResourceRow) => void;
    onBrowseInstances: (row: CustomResourceRow) => void;
    onDelete: (row: CustomResourceRow) => void;
  }

  let {
    row,
    isOpen,
    onClose,
    onOpenYaml,
    onCopyKubectlGetYaml,
    onCopyKubectlDescribe,
    onRunDebugDescribe,
    onInvestigate,
    onBrowseInstances,
    onDelete,
  }: Props = $props();

  function getLabels() {
    const labels = row?.raw.metadata && typeof row.raw.metadata === "object"
      ? (row.raw.metadata as { labels?: Record<string, string> }).labels
      : undefined;
    return Object.entries(labels ?? {});
  }

  function getAnnotations() {
    const annotations = row?.raw.metadata && typeof row.raw.metadata === "object"
      ? (row.raw.metadata as { annotations?: Record<string, string> }).annotations
      : undefined;
    return Object.entries(annotations ?? {});
  }

  function getFields() {
    if (!row) return [];
    return [
      { label: "Group", value: row.group },
      { label: "Version", value: row.version },
      { label: "Scope", value: row.scope },
      { label: "Resource", value: row.resource },
      { label: "Summary", value: row.summary, colSpan: 2 as const },
      { label: "Age", value: row.age },
      { label: "Name", value: row.name },
    ];
  }
</script>

{#if isOpen && row}
<DetailsSheetPortal open={isOpen} onClose={onClose} closeAriaLabel="Close custom resource details" maxWidthClass="sm:max-w-[44rem]">
      <DetailsSheetHeader
        title="Custom Resource Definition"
        name={row.name}
        icon={Info}
        onClose={onClose}
        closeAriaLabel="Close custom resource details"
        actions={[
          {
            id: "edit-yaml",
            title: "Edit YAML",
            ariaLabel: "Edit custom resource definition YAML",
            icon: Pencil,
            onClick: () => onOpenYaml(row),
          },
          {
            id: "yaml",
            title: "Copy kubectl get -o yaml",
            ariaLabel: "Copy kubectl get -o yaml",
            icon: Copy,
            onClick: () => onCopyKubectlGetYaml(row),
          },
          {
            id: "describe",
            title: "Copy kubectl describe",
            ariaLabel: "Copy kubectl describe",
            icon: ClipboardList,
            onClick: () => onCopyKubectlDescribe(row),
          },
          {
            id: "debug-describe",
            title: "Run debug describe",
            ariaLabel: "Run debug describe",
            icon: Bug,
            onClick: () => onRunDebugDescribe(row),
          },
          ...(onInvestigate
            ? [
                {
                  id: "investigate",
                  title: "Investigate",
                  ariaLabel: "Investigate custom resource definition",
                  icon: Search,
                  onClick: () => onInvestigate(row),
                },
              ]
            : []),
          {
            id: "browse-instances",
            title: "Browse instances",
            ariaLabel: "Browse custom resource instances",
            icon: FolderSearch,
            onClick: () => onBrowseInstances(row),
          },
          {
            id: "delete",
            title: "Delete",
            ariaLabel: "Delete custom resource definition",
            icon: Trash,
            destructive: true,
            onClick: () => onDelete(row),
          },
        ]}
      />

      <div class="flex-1 space-y-4 overflow-auto px-4 py-4">
        <DetailsMetadataGrid
          fields={getFields()}
          labels={getLabels()}
          annotations={getAnnotations()}
          contextKey={`custom-resource-details:${row.uid}`}
        />
      </div>
</DetailsSheetPortal>
{/if}
