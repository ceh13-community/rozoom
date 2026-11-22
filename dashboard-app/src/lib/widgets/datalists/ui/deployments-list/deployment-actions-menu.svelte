<script lang="ts">
  import { createMenuAction } from "../common/menu-action";
  import { Button } from "$shared/ui/button";
  import * as DropdownMenu from "$shared/ui/dropdown-menu";
  import { MoreVertical } from "$shared/ui/icons";
  import Bug from "@lucide/svelte/icons/bug";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Activity from "@lucide/svelte/icons/activity";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Pause from "@lucide/svelte/icons/pause";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import ArrowUpDown from "@lucide/svelte/icons/arrow-up-down";
  import Undo2 from "@lucide/svelte/icons/undo-2";

  type DeploymentActionsMenuProps = {
    name: string;
    namespace: string;
    disabled?: boolean;
    isBusy?: boolean;
    onShowDetails: () => void;
    onLogs: () => void;
    onEvents: () => void;
    onEditYaml: () => void;
    onInvestigate: () => void;
    onScale: () => void;
    onCopyDescribe?: () => void;
    onRunDebugDescribe?: () => void;
    onRolloutStatus: () => void;
    onRolloutHistory: () => void;
    onDownloadYaml: () => void;
    onRestart: () => void;
    onPause: () => void;
    onResume: () => void;
    onUndo: () => void;
    onDelete: () => void;
  };

  const {
    name,
    namespace,
    disabled = false,
    isBusy = false,
    onShowDetails,
    onLogs,
    onEvents,
    onEditYaml,
    onInvestigate,
    onScale,
    onCopyDescribe = () => {},
    onRunDebugDescribe = () => {},
    onRolloutStatus,
    onRolloutHistory,
    onDownloadYaml,
    onRestart,
    onPause,
    onResume,
    onUndo,
    onDelete,
  }: DeploymentActionsMenuProps = $props();

  let open = $state(false);

  let triggerRef = $state<HTMLElement | null>(null);
  // The action runs after the menu closed, so the menu's focus return cannot scroll the
  // page back to the row after the action revealed its panel.
  const menuAction = createMenuAction({
    close: () => {
      open = false;
    },
    getTrigger: () => triggerRef,
    isBlocked: () => disabled || isBusy,
  });
  const selectAction = (callback: () => void) => menuAction.select(callback);

  $effect(() => {
    if (open) menuAction.reset();
  });
</script>

<DropdownMenu.Root bind:open>
  <!-- One button: the trigger props go on it (a button inside a button was two Tab stops). -->
  <DropdownMenu.Trigger bind:ref={triggerRef}>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="ghost"
        size="icon"
        class="h-6 w-6"
        aria-label={`Open actions for ${name}`}
        title={`Actions: ${namespace}/${name}`}
        disabled={disabled || isBusy}
        onclick={(event: MouseEvent) => {
          // The row opens its details on click: the menu button keeps the click.
          event.stopPropagation();
          (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
        }}
      >
        <MoreVertical class="h-4 w-4" />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="pt-0" onCloseAutoFocus={menuAction.onCloseAutoFocus}>
    <DropdownMenu.Item onSelect={() => selectAction(onShowDetails)}>
      <Info class="mr-2 h-4 w-4" />
      Show details
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onLogs)}>
      <ScrollText class="mr-2 h-4 w-4" />
      Logs
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onEvents)}>
      <Activity class="mr-2 h-4 w-4" />
      Events
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Manifest</DropdownMenu.Label>
    <DropdownMenu.Item onSelect={() => selectAction(onEditYaml)}>
      <Pencil class="mr-2 h-4 w-4" />
      Edit YAML
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onCopyDescribe)}>
      <ClipboardList class="mr-2 h-4 w-4" />
      Copy kubectl describe
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onRunDebugDescribe)}>
      <Bug class="mr-2 h-4 w-4" />
      Run debug describe
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onDownloadYaml)}>
      <FileDown class="mr-2 h-4 w-4" />
      Download YAML
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Diagnostics</DropdownMenu.Label>
    <DropdownMenu.Item onSelect={() => selectAction(onInvestigate)}>
      <Search class="mr-2 h-4 w-4" />
      Investigate
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onScale)}>
      <ArrowUpDown class="mr-2 h-4 w-4" />
      Scale
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Label>Rollout</DropdownMenu.Label>
    <DropdownMenu.Item onSelect={() => selectAction(onRolloutStatus)}>
      <Clock3 class="mr-2 h-4 w-4" />
      Rollout status
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onRolloutHistory)}>
      <ListTree class="mr-2 h-4 w-4" />
      Rollout history
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onRestart)}>
      <RotateCcw class="mr-2 h-4 w-4" />
      Rollout restart
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onPause)}>
      <Pause class="mr-2 h-4 w-4" />
      Pause rollout
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onResume)}>
      <Play class="mr-2 h-4 w-4" />
      Resume rollout
    </DropdownMenu.Item>
    <DropdownMenu.Item onSelect={() => selectAction(onUndo)}>
      <Undo2 class="mr-2 h-4 w-4" />
      Undo revision
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item
      class="text-destructive focus:text-destructive"
      onSelect={() => selectAction(onDelete)}
    >
      <Trash class="mr-2 h-4 w-4" />
      Delete
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
