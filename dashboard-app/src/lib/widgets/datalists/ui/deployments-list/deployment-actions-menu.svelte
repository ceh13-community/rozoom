<script lang="ts">
  import { tick } from "svelte";
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
