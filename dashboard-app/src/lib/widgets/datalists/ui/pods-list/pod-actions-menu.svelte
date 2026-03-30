<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$shared/ui/button";
  import * as DropdownMenu from "$shared/ui/dropdown-menu";
  import { MoreVertical } from "$shared/ui/icons";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Info from "@lucide/svelte/icons/info";
  import Copy from "@lucide/svelte/icons/copy";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Bug from "@lucide/svelte/icons/bug";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import Search from "@lucide/svelte/icons/search";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Link2 from "@lucide/svelte/icons/link-2";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Trash from "@lucide/svelte/icons/trash";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import UserX from "@lucide/svelte/icons/user-x";

  type PodActionsMenuProps = {
    name: string;
    namespace: string;
    showShowDetails?: boolean;
    showEvents?: boolean;
    showShell?: boolean;
    showAttach?: boolean;
    showEditYaml?: boolean;
    showInvestigate?: boolean;
    showExportIncident?: boolean;
    showDownloadYaml?: boolean;
    showCopyDescribe?: boolean;
    showRunDebugDescribe?: boolean;
    showCopyDebug?: boolean;
    showPreviousLogs?: boolean;
    showPortForward?: boolean;
    showEvict?: boolean;
    showLogs?: boolean;
    showDelete?: boolean;
    isDeleting: boolean;
    isEvicting: boolean;
    isYamlBusy: boolean;
    isExportingIncident: boolean;
    isDownloadingYaml: boolean;
    onShowDetails?: () => void;
    onEvents?: () => void;
    onShell: () => void;
    onAttach: () => void;
    onEditYaml: () => void;
    onInvestigate: () => void;
    onExportIncident: () => void;
    onDownloadYaml: () => void;
    onCopyDescribe: () => void;
    onRunDebugDescribe: () => void;
    onCopyDebug: () => void;
    onPreviousLogs: () => void;
    onPortForward: () => void;
    onEvict: () => void;
    onLogs: () => void;
    onDelete: () => void;
  };

  const {
    name,
    namespace,
    showShowDetails = true,
    showEvents = true,
    showShell = true,
    showAttach = true,
    showEditYaml = true,
    showInvestigate = true,
    showExportIncident = true,
    showDownloadYaml = true,
    showCopyDescribe = true,
    showRunDebugDescribe = true,
    showCopyDebug = true,
    showPreviousLogs = true,
    showPortForward = true,
    showEvict = true,
    showLogs = true,
    showDelete = true,
    isDeleting,
    isEvicting,
    isYamlBusy,
    isExportingIncident,
    isDownloadingYaml,
    onShowDetails,
    onEvents,
    onShell,
    onAttach,
    onEditYaml,
    onInvestigate,
    onExportIncident,
    onDownloadYaml,
    onCopyDescribe,
    onRunDebugDescribe,
    onCopyDebug,
    onPreviousLogs,
    onPortForward,
    onEvict,
    onLogs,
    onDelete,
  }: PodActionsMenuProps =
    $props();

  let open = $state(false);

  async function selectAction(callback: () => void) {
    open = false;
    await tick();
    callback();
  }
</script>

<div data-pod-actions-menu="true">
  <DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Open actions for ${name}`}
        onclick={(event) => event.stopPropagation()}
      >
        <MoreVertical class="h-4 w-4" />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="pt-0">
      {#if showShowDetails && onShowDetails}
        <DropdownMenu.Item onSelect={() => selectAction(onShowDetails)}>
          <Info class="mr-2 h-4 w-4" />
          Show details
        </DropdownMenu.Item>
      {/if}
      {#if showEvents && onEvents}
        <DropdownMenu.Item onSelect={() => selectAction(onEvents)}>
          <Clock3 class="mr-2 h-4 w-4" />
          Events
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Label>Access</DropdownMenu.Label>
      {#if showShell}
        <DropdownMenu.Item onSelect={() => selectAction(onShell)}>
          <Terminal class="mr-2 h-4 w-4" />
          Shell
        </DropdownMenu.Item>
      {/if}
      {#if showAttach}
        <DropdownMenu.Item onSelect={() => selectAction(onAttach)}>
          <Plug class="mr-2 h-4 w-4" />
          Attach pod
        </DropdownMenu.Item>
      {/if}
      {#if showLogs}
        <DropdownMenu.Item onSelect={() => selectAction(onLogs)}>
          <ScrollText class="mr-2 h-4 w-4" />
          Logs
        </DropdownMenu.Item>
      {/if}
      {#if showPreviousLogs}
        <DropdownMenu.Item onSelect={() => selectAction(onPreviousLogs)}>
          <RotateCcw class="mr-2 h-4 w-4" />
          Previous logs
        </DropdownMenu.Item>
      {/if}
      {#if showPortForward}
        <DropdownMenu.Item onSelect={() => selectAction(onPortForward)}>
          <Link2 class="mr-2 h-4 w-4" />
          Port-forward preview
        </DropdownMenu.Item>
      {/if}

      <DropdownMenu.Separator />
      <DropdownMenu.Label>Manifest</DropdownMenu.Label>
      {#if showEditYaml}
        <DropdownMenu.Item disabled={isYamlBusy} onSelect={() => selectAction(onEditYaml)}>
          <Pencil class="mr-2 h-4 w-4" />
          {isYamlBusy ? "Loading YAML" : "Edit YAML"}
        </DropdownMenu.Item>
      {/if}
      {#if showDownloadYaml}
        <DropdownMenu.Item
          disabled={isDownloadingYaml}
          onSelect={() => selectAction(onDownloadYaml)}
        >
          <FileDown class="mr-2 h-4 w-4" />
          {isDownloadingYaml ? "Downloading YAML" : "Download YAML"}
        </DropdownMenu.Item>
      {/if}
      {#if showCopyDescribe}
        <DropdownMenu.Item onSelect={() => selectAction(onCopyDescribe)}>
          <ClipboardList class="mr-2 h-4 w-4" />
          Copy kubectl describe
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Diagnostics</DropdownMenu.Label>
      {#if showRunDebugDescribe}
        <DropdownMenu.Item onSelect={() => selectAction(onRunDebugDescribe)}>
          <Bug class="mr-2 h-4 w-4" />
          Run debug describe
        </DropdownMenu.Item>
      {/if}
      {#if showCopyDebug}
        <DropdownMenu.Item onSelect={() => selectAction(onCopyDebug)}>
          <Copy class="mr-2 h-4 w-4" />
          Copy kubectl debug
        </DropdownMenu.Item>
      {/if}
      {#if showInvestigate}
        <DropdownMenu.Item disabled={isYamlBusy} onSelect={() => selectAction(onInvestigate)}>
          <Search class="mr-2 h-4 w-4" />
          Investigate
        </DropdownMenu.Item>
      {/if}
      {#if showExportIncident}
        <DropdownMenu.Item
          disabled={isExportingIncident}
          onSelect={() => selectAction(onExportIncident)}
        >
          <TriangleAlert class="mr-2 h-4 w-4" />
          {isExportingIncident ? "Exporting incident..." : "Export incident"}
        </DropdownMenu.Item>
      {/if}
      {#if showEvict || showDelete}
        <DropdownMenu.Separator />
        <DropdownMenu.Label>Dangerous</DropdownMenu.Label>
      {/if}
      {#if showEvict}
        <DropdownMenu.Item disabled={isEvicting} onSelect={() => selectAction(onEvict)}>
          <UserX class="mr-2 h-4 w-4" />
          {isEvicting ? "Evicting..." : "Evict (one-way)"}
        </DropdownMenu.Item>
      {/if}
      {#if showDelete}
        <DropdownMenu.Item
          disabled={isDeleting}
          class="text-destructive focus:text-destructive"
          onSelect={() => selectAction(onDelete)}
        >
          <Trash class="mr-2 h-4 w-4" />
          {isDeleting ? "Deleting" : "Delete"}
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>
