<script lang="ts">
  import { Button } from "$shared/ui/button";
  import { Trash } from "$shared/ui/icons";
  import Archive from "@lucide/svelte/icons/archive";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Search from "@lucide/svelte/icons/search";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Terminal from "@lucide/svelte/icons/terminal";
  import UserX from "@lucide/svelte/icons/user-x";

  type PodBulkActionsProps = {
    canOpenShell: boolean;
    canAttach: boolean;
    canEditYaml: boolean;
    canInvestigate: boolean;
    canCopyDescribe: boolean;
    canRunDebugDescribe: boolean;
    canCopyDebug: boolean;
    canExportIncident: boolean;
    canDownloadYaml: boolean;
    canOpenLogs: boolean;
    canOpenPreviousLogs: boolean;
    isYamlBusy: boolean;
    isExportingIncident: boolean;
    isDownloadingYaml: boolean;
    isDeleting: boolean;
    isEvicting: boolean;
    onShell: () => void;
    onAttach: () => void;
    onEditYaml: () => void;
    onInvestigate: () => void;
    onCopyDescribe: () => void;
    onRunDebugDescribe: () => void;
    onCopyDebug: () => void;
    onExportIncident: () => void;
    onDownloadYaml: () => void;
    onEvict: () => void;
    onLogs: () => void;
    onPreviousLogs: () => void;
    onDelete: () => void;
  };

  const {
    canOpenShell,
    canAttach,
    canEditYaml,
    canInvestigate,
    canCopyDescribe,
    canRunDebugDescribe,
    canCopyDebug,
    canExportIncident,
    canDownloadYaml,
    canOpenLogs,
    canOpenPreviousLogs,
    isYamlBusy,
    isExportingIncident,
    isDownloadingYaml,
    isDeleting,
    isEvicting,
    onShell,
    onAttach,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onRunDebugDescribe,
    onCopyDebug,
    onExportIncident,
    onDownloadYaml,
    onEvict,
    onLogs,
    onPreviousLogs,
    onDelete,
  }: PodBulkActionsProps = $props();
</script>

<div class="flex items-center gap-1">
  {#if canOpenShell}
    <Button variant="ghost" size="icon" aria-label="Shell" title="Shell" disabled={false} onclick={onShell}>
      <Terminal class="h-4 w-4" />
    </Button>
  {/if}
  {#if canAttach}
    <Button variant="ghost" size="icon" aria-label="Attach pod" title="Attach pod" disabled={false} onclick={onAttach}>
      <Plug class="h-4 w-4" />
    </Button>
  {/if}
  {#if canEditYaml}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Edit YAML"
      title={isYamlBusy ? "Loading YAML" : "Edit YAML"}
      disabled={isYamlBusy}
      onclick={onEditYaml}
    >
      <Pencil class="h-4 w-4" />
    </Button>
  {/if}
  {#if canInvestigate}
    <Button variant="ghost" size="icon" aria-label="Investigate" title="Investigate" disabled={isYamlBusy} onclick={onInvestigate}>
      <Search class="h-4 w-4" />
    </Button>
  {/if}
  {#if canDownloadYaml}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Download YAML"
      title={isDownloadingYaml ? "Downloading YAML" : "Download YAML"}
      disabled={isDownloadingYaml}
      onclick={onDownloadYaml}
    >
      <FileDown class="h-4 w-4" />
    </Button>
  {/if}
  {#if canCopyDescribe}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy kubectl describe"
      title="Copy kubectl describe"
      disabled={false}
      onclick={onCopyDescribe}
    >
      <ClipboardList class="h-4 w-4" />
    </Button>
  {/if}
  {#if canRunDebugDescribe}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Run debug describe"
      title="Run debug describe"
      disabled={false}
      onclick={onRunDebugDescribe}
    >
      <Copy class="h-4 w-4" />
    </Button>
  {/if}
  {#if canCopyDebug}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Copy kubectl debug"
      title="Copy kubectl debug"
      disabled={false}
      onclick={onCopyDebug}
    >
      <Bug class="h-4 w-4" />
    </Button>
  {/if}
  {#if canExportIncident}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Export incident"
      title={isExportingIncident ? "Exporting incident..." : "Export incident"}
      disabled={isExportingIncident}
      onclick={onExportIncident}
    >
      <Archive class="h-4 w-4" />
    </Button>
  {/if}
  <Button
    variant="ghost"
    size="icon"
    aria-label="Evict selected pods"
    title="Evict (one-way)"
    disabled={isEvicting}
    onclick={onEvict}
  >
    <UserX class="h-4 w-4" />
  </Button>
  {#if canOpenLogs}
    <Button variant="ghost" size="icon" aria-label="Logs" title="Logs" disabled={false} onclick={onLogs}>
      <ScrollText class="h-4 w-4" />
    </Button>
  {/if}
  {#if canOpenPreviousLogs}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Previous logs"
      title="Previous logs"
      disabled={false}
      onclick={onPreviousLogs}
    >
      <RotateCcw class="h-4 w-4" />
    </Button>
  {/if}
  <Button
    variant="ghost"
    size="icon"
    aria-label="Delete selected pods"
    title="Delete"
    class="text-destructive hover:text-destructive"
    disabled={isDeleting}
    onclick={() => onDelete()}
  >
    <Trash class="h-4 w-4" />
  </Button>
</div>
