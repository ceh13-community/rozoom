<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$shared/ui/button";
  import * as DropdownMenu from "$shared/ui/dropdown-menu";
  import { MoreVertical } from "$shared/ui/icons";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Info from "@lucide/svelte/icons/info";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";

  type ConfigurationActionsMenuProps = {
    name: string;
    namespace: string;
    disabled?: boolean;
    isBusy?: boolean;
    onShowDetails: () => void;
    onEditYaml: () => void;
    onCopyKubectlGetYaml: () => void;
    onCopyKubectlDescribe: () => void;
    onRunDebugDescribe?: () => void;
    onInvestigate?: () => void;
    onDownloadYaml?: () => void;
    onPortForward?: () => void;
    onDelete: () => void;
  };

  const {
    name,
    namespace,
    disabled = false,
    isBusy = false,
    onShowDetails,
    onEditYaml,
    onCopyKubectlGetYaml,
    onCopyKubectlDescribe,
    onRunDebugDescribe,
    onInvestigate,
    onDownloadYaml,
    onPortForward,
    onDelete,
  }: ConfigurationActionsMenuProps = $props();

  let open = $state(false);

  async function selectAction(callback: () => void) {
    if (disabled || isBusy) return;
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
      title={`Actions: ${namespace}/${name}`}
      disabled={disabled || isBusy}
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
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Manifest</DropdownMenu.Label>
    <DropdownMenu.Item onSelect={() => selectAction(onEditYaml)}>
      <Pencil class="mr-2 h-4 w-4" />
      Edit YAML
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onCopyKubectlGetYaml)}>
      <Copy class="mr-2 h-4 w-4" />
      Copy kubectl get -o yaml
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onCopyKubectlDescribe)}>
      <ClipboardList class="mr-2 h-4 w-4" />
      Copy kubectl describe
    </DropdownMenu.Item>
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
    {#if onInvestigate || onPortForward}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Diagnostics</DropdownMenu.Label>
    {/if}
    {#if onInvestigate}
      <DropdownMenu.Item onSelect={() => selectAction(onInvestigate)}>
        <Search class="mr-2 h-4 w-4" />
        Investigate
      </DropdownMenu.Item>
    {/if}
    {#if onPortForward}
      <DropdownMenu.Item onSelect={() => selectAction(onPortForward)}>
        <Link2 class="mr-2 h-4 w-4" />
        Port-forward preview
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item class="text-destructive focus:text-destructive" onSelect={() => selectAction(onDelete)}>
      <Trash class="mr-2 h-4 w-4" />
      Delete
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
