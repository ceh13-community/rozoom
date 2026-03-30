<script lang="ts">
  import type { Writable } from "svelte/store";
  import { Button } from "$shared/ui/button";
  import WorkbenchSheetShell from "./workbench-sheet-shell.svelte";

  interface WorkloadCommandOutputSheetProps {
    embedded?: boolean;
    isOpen: Writable<boolean>;
    title: string;
    collapsedLabel: string;
    commandLabel?: string | null;
    output: string;
    loading: boolean;
    error: string | null;
    canVerticalCollapse?: boolean;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse?: () => void;
    onRefresh?: () => void;
  }

  const {
    embedded = false,
    isOpen,
    title,
    collapsedLabel,
    commandLabel = null,
    output,
    loading,
    error,
    canVerticalCollapse = false,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse = () => {},
    onRefresh,
  }: WorkloadCommandOutputSheetProps = $props();

  let isFullscreen = $state(false);
</script>

<WorkbenchSheetShell
  {embedded}
  {isOpen}
  {title}
  {collapsedLabel}
  standaloneMaxWidthClass="sm:max-w-[70vw]"
  {canVerticalCollapse}
  {isVerticallyCollapsed}
  {onToggleVerticalCollapse}
  {isFullscreen}
  onToggleFullscreen={() => {
    isFullscreen = !isFullscreen;
  }}
>
  <div class="min-h-0 flex-1 overflow-auto p-3">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div class="min-w-0 text-xs text-muted-foreground">{commandLabel ?? "Command output"}</div>
      {#if onRefresh}
        <Button type="button" variant="outline" size="sm" onclick={onRefresh}>Refresh</Button>
      {/if}
    </div>
    {#if error}
      <div class="mb-3 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    {/if}
    {#if loading && !output}
      <div class="text-sm text-muted-foreground">Loading output...</div>
    {:else if !output}
      <div class="text-sm text-muted-foreground">No output yet.</div>
    {:else}
      <pre class="overflow-x-auto whitespace-pre-wrap break-words rounded border bg-muted/30 p-3 text-xs">{output}</pre>
    {/if}
  </div>
</WorkbenchSheetShell>
