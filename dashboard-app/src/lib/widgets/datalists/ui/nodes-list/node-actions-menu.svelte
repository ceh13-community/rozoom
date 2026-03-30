<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$shared/ui/button";
  import * as DropdownMenu from "$shared/ui/dropdown-menu";
  import { MoreVertical } from "$shared/ui/icons";
  import Activity from "@lucide/svelte/icons/activity";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Plug from "@lucide/svelte/icons/plug";
  import Search from "@lucide/svelte/icons/search";
  import Terminal from "@lucide/svelte/icons/terminal";
  import Trash from "@lucide/svelte/icons/trash";
  import UserX from "@lucide/svelte/icons/user-x";

  type NodeActionsMenuProps = {
    name: string;
    isUnschedulable: boolean;
    isCordoning: boolean;
    isDraining: boolean;
    isDeleting: boolean;
    onShowDetails: () => void;
    onTopNode: () => void;
    onEvents: () => void;
    onShell: () => void;
    onToggleCordon: () => void;
    onDrain: () => void;
    onEditYaml: () => void;
    onInvestigate?: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onDownloadYaml?: () => void;
    onDelete: () => void;
  };

  const {
    name,
    isUnschedulable,
    isCordoning,
    isDraining,
    isDeleting,
    onShowDetails,
    onTopNode,
    onEvents,
    onShell,
    onToggleCordon,
    onDrain,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onRunDebugDescribe,
    onDownloadYaml,
    onDelete,
  }: NodeActionsMenuProps = $props();

  let open = $state(false);

  async function selectAction(callback: () => void) {
    open = false;
    await tick();
    callback();
  }
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Open actions for ${name}`}
      title={`Actions: ${name}`}
      onclick={(event) => event.stopPropagation()}
    >
      <MoreVertical class="h-4 w-4" />
    </Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="pt-0">
    <DropdownMenu.Item onSelect={() => selectAction(onShowDetails)}>
      <Info class="mr-2 h-4 w-4" />
      Show details
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onTopNode)}>
      <Activity class="mr-2 h-4 w-4" />
      Top node
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onEvents)}>
      <Clock3 class="mr-2 h-4 w-4" />
      Events
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onShell)}>
      <Terminal class="mr-2 h-4 w-4" />
      Shell
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Manifest</DropdownMenu.Label>
    <DropdownMenu.Item onSelect={() => selectAction(onEditYaml)}>
      <Pencil class="mr-2 h-4 w-4" />
      Edit YAML
    </DropdownMenu.Item>
    {#if onCopyDescribe}
      <DropdownMenu.Item onSelect={() => selectAction(onCopyDescribe)}>
        <ClipboardList class="mr-2 h-4 w-4" />
        Copy kubectl describe
      </DropdownMenu.Item>
    {/if}
    {#if onRunDebugDescribe}
      <DropdownMenu.Item onSelect={() => selectAction(onRunDebugDescribe)}>
        <Bug class="mr-2 h-4 w-4" />
        Run debug describe
      </DropdownMenu.Item>
    {/if}
    {#if onDownloadYaml}
      <DropdownMenu.Item onSelect={() => selectAction(onDownloadYaml)}>
        <FileDown class="mr-2 h-4 w-4" />
        Download YAML
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Diagnostics</DropdownMenu.Label>
    {#if onInvestigate}
      <DropdownMenu.Item onSelect={() => selectAction(onInvestigate)}>
        <Search class="mr-2 h-4 w-4" />
        Investigate
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Dangerous</DropdownMenu.Label>
    <DropdownMenu.Item disabled={isCordoning} onSelect={() => selectAction(onToggleCordon)}>
      <UserX class="mr-2 h-4 w-4" />
      {#if isCordoning}
        {isUnschedulable ? "Uncordoning..." : "Cordoning..."}
      {:else}
        {isUnschedulable ? "Uncordon" : "Cordon"}
      {/if}
    </DropdownMenu.Item>
    <DropdownMenu.Item disabled={isDraining} onSelect={() => selectAction(onDrain)}>
      <Plug class="mr-2 h-4 w-4" />
      {isDraining ? "Draining..." : "Drain"}
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item
      disabled={isDeleting}
      class="text-destructive focus:text-destructive"
      onSelect={() => selectAction(onDelete)}
    >
      <Trash class="mr-2 h-4 w-4" />
      {isDeleting ? "Deleting" : "Delete"}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
