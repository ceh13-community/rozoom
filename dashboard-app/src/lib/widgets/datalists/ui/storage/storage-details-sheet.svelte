<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import type { StorageRow } from "./model/storage-row-adapter";
  import DetailsSheetHeader from "../common/details-sheet-header.svelte";
  import DetailsMetadataGrid from "../common/details-metadata-grid.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";

  interface Props {
    row: StorageRow | null;
    isOpen: boolean;
    onClose: () => void;
    onOpenYaml: (row: StorageRow) => void;
    onCopyKubectlGetYaml: (row: StorageRow) => void;
    onCopyKubectlDescribe: (row: StorageRow) => void;
    onRunDebugDescribe: (row: StorageRow) => void;
    onInvestigate?: (row: StorageRow) => void;
    onDelete: (row: StorageRow) => void;
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
      { label: "Namespace", value: row.namespace },
      { label: "Kind", value: row.kind },
      { label: "Storage Class", value: row.storageClass },
      { label: "Phase", value: row.phase },
      { label: "Capacity", value: row.capacity },
      { label: "Claim", value: row.claim },
      { label: "Summary", value: row.summary, colSpan: 2 as const },
      { label: "Age", value: row.age },
      { label: "Name", value: row.name },
    ];
  }
</script>

{#if isOpen && row}
<DetailsSheetPortal open={isOpen} onClose={onClose} closeAriaLabel="Close storage details" maxWidthClass="sm:max-w-[44rem]">
      <DetailsSheetHeader
        title="Storage resource"
        name={row.name}
        icon={Info}
        onClose={onClose}
        closeAriaLabel="Close storage details"
        actions={[
          {
            id: "edit-yaml",
            title: "Edit YAML",
            ariaLabel: "Edit storage YAML",
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
            ? [{
                id: "investigate",
                title: "Investigate",
                ariaLabel: "Investigate storage resource",
                icon: Search,
                onClick: () => onInvestigate(row),
              }]
            : []),
          {
            id: "delete",
            title: "Delete",
            ariaLabel: "Delete storage resource",
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
          contextKey={`storage-details:${row.uid}`}
        />
      </div>
</DetailsSheetPortal>
{/if}
