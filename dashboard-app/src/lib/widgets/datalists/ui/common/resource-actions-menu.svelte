<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$shared/ui/button";
  import * as DropdownMenu from "$shared/ui/dropdown-menu";
  import { MoreVertical } from "$shared/ui/icons";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Copy from "@lucide/svelte/icons/copy";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import Link2 from "@lucide/svelte/icons/link-2";
  import Pencil from "@lucide/svelte/icons/pencil";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";

  export type ResourceActionItem = {
    id: string;
    label: string;
    icon: typeof Info;
    action: () => void;
    destructive?: boolean;
    separator?: boolean;
  };

  type ResourceActionsMenuProps = {
    name: string;
    namespace?: string;
    disabled?: boolean;
    isBusy?: boolean;
    onShowDetails?: () => void;
    onLogs?: () => void;
    onEditYaml?: () => void;
    onInvestigate?: () => void;
    onCopyDescribe?: () => void;
    onCopyKubectlGetYaml?: () => void;
    onCopyKubectlDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onDownloadYaml?: () => void;
    onOpenWeb?: () => void;
    onDelete?: () => void;
    extraItems?: ResourceActionItem[];
  };

  const {
    name,
    namespace,
    disabled = false,
    isBusy = false,
    onShowDetails,
    onLogs,
    onEditYaml,
    onInvestigate,
    onCopyDescribe,
    onCopyKubectlGetYaml,
    onCopyKubectlDescribe,
    onRunDebugDescribe,
    onDownloadYaml,
    onOpenWeb,
    onDelete,
    extraItems = [],
  }: ResourceActionsMenuProps = $props();

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
      title={namespace ? `Actions: ${namespace}/${name}` : `Actions: ${name}`}
      disabled={disabled || isBusy}
      onclick={(event) => event.stopPropagation()}
    >
      <MoreVertical class="h-4 w-4" />
    </Button>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="pt-0">
    {#if onShowDetails}
      <DropdownMenu.Item onSelect={() => selectAction(onShowDetails)}>
        <Info class="mr-2 h-4 w-4" />
        Show details
      </DropdownMenu.Item>
    {/if}
    {#if onLogs}
      <DropdownMenu.Item onSelect={() => selectAction(onLogs)}>
        <ScrollText class="mr-2 h-4 w-4" />
        Logs
      </DropdownMenu.Item>
    {/if}
    {#if onEditYaml || onCopyDescribe || onCopyKubectlDescribe || onRunDebugDescribe || onDownloadYaml}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Manifest</DropdownMenu.Label>
    {/if}
    {#if onEditYaml}
      <DropdownMenu.Item onSelect={() => selectAction(onEditYaml)}>
        <Pencil class="mr-2 h-4 w-4" />
        Edit YAML
      </DropdownMenu.Item>
    {/if}
    {#if onCopyKubectlGetYaml}
      <DropdownMenu.Item onSelect={() => selectAction(onCopyKubectlGetYaml)}>
        <Copy class="mr-2 h-4 w-4" />
        Copy kubectl get -o yaml
      </DropdownMenu.Item>
    {/if}
    {#if onCopyDescribe || onCopyKubectlDescribe}
      <DropdownMenu.Item onSelect={() => selectAction((onCopyDescribe ?? onCopyKubectlDescribe)!)}>
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
    {#if onInvestigate || onOpenWeb || extraItems.length > 0}
      <DropdownMenu.Separator />
      <DropdownMenu.Label>Diagnostics</DropdownMenu.Label>
    {/if}
    {#if onInvestigate}
      <DropdownMenu.Item onSelect={() => selectAction(onInvestigate)}>
        <Search class="mr-2 h-4 w-4" />
        Investigate
      </DropdownMenu.Item>
    {/if}
    {#if onOpenWeb}
      <DropdownMenu.Item onSelect={() => selectAction(onOpenWeb)}>
        <Link2 class="mr-2 h-4 w-4" />
        Open web tool
      </DropdownMenu.Item>
    {/if}
    {#each extraItems as item (item.id)}
      <DropdownMenu.Item
        class={item.destructive ? "text-destructive focus:text-destructive" : ""}
        onSelect={() => selectAction(item.action)}
      >
        {@const Icon = item.icon}
        <Icon class="mr-2 h-4 w-4" />
        {item.label}
      </DropdownMenu.Item>
    {/each}
    {#if onDelete}
      <DropdownMenu.Separator />
      <DropdownMenu.Item
        class="text-destructive focus:text-destructive"
        onSelect={() => selectAction(onDelete)}
      >
        <Trash class="mr-2 h-4 w-4" />
        Delete
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
