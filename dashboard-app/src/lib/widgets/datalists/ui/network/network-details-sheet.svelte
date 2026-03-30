<script lang="ts">
  import Info from "@lucide/svelte/icons/info";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import type { NetworkListRow } from "./model/network-list-row";
  import DetailsSheetHeader from "../common/details-sheet-header.svelte";
  import DetailsMetadataGrid from "../common/details-metadata-grid.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";
  import ResourceTrafficChain from "../common/resource-traffic-chain.svelte";

  interface Props {
    clusterId: string;
    row: NetworkListRow | null;
    isOpen: boolean;
    showOpenWeb?: boolean;
    onClose: () => void;
    onOpenWeb?: (row: NetworkListRow) => void;
    onCopyKubectlGetYaml: (row: NetworkListRow) => void;
    onCopyKubectlDescribe: (row: NetworkListRow) => void;
    onRunDebugDescribe: (row: NetworkListRow) => void;
    onInvestigate?: (row: NetworkListRow) => void;
    onDelete: (row: NetworkListRow) => void;
  }

  let {
    clusterId,
    row,
    isOpen,
    showOpenWeb = false,
    onClose,
    onOpenWeb,
    onCopyKubectlGetYaml,
    onCopyKubectlDescribe,
    onRunDebugDescribe,
    onInvestigate,
    onDelete,
  }: Props = $props();

  const trafficChainKinds = new Set(["Ingress", "Service", "Deployment", "StatefulSet", "DaemonSet"]);

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
      { label: "Kind", value: row.subtype },
      { label: "Summary", value: row.summary, colSpan: 2 as const },
      { label: "Ports", value: row.ports },
      { label: "Age", value: row.age },
      { label: "Name", value: row.name },
    ];
  }
</script>

{#if isOpen && row}
<DetailsSheetPortal open={isOpen} onClose={onClose} closeAriaLabel="Close network details" maxWidthClass="sm:max-w-[44rem]">
      <DetailsSheetHeader
        title="Network resource"
        name={row.name}
        icon={Info}
        onClose={onClose}
        closeAriaLabel="Close network details"
        actions={[
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
                ariaLabel: "Investigate network resource",
                icon: Search,
                onClick: () => onInvestigate(row),
              }]
            : []),
          ...(showOpenWeb && onOpenWeb
            ? [{
                id: "web",
                title: "Open web tool",
                ariaLabel: "Open service web tool",
                icon: Link2,
                onClick: () => onOpenWeb(row),
              }]
            : []),
          {
            id: "delete",
            title: "Delete",
            ariaLabel: "Delete network resource",
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
          contextKey={`network-details:${row.uid}`}
        />

        {#if trafficChainKinds.has(row.subtype)}
          <ResourceTrafficChain
            {clusterId}
            resourceKind={row.subtype}
            resourceName={row.name}
            resourceNamespace={row.namespace}
            raw={row.raw as Record<string, unknown>}
          />
        {/if}
      </div>
</DetailsSheetPortal>
{/if}
