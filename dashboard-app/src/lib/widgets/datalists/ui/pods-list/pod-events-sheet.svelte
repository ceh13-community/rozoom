<script lang="ts">
  import { tick } from "svelte";
  import type { Writable } from "svelte/store";
  import type { PodEvent } from "$features/pod-details";
  import WorkbenchSheetShell from "../common/workbench-sheet-shell.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface PodEventsSheetProps {
    embedded?: boolean;
    isOpen: Writable<boolean>;
    podRef: string;
    events: PodEvent[];
    loading: boolean;
    error: string | null;
    focusedEventIndex: number | null;
    canVerticalCollapse?: boolean;
    isVerticallyCollapsed?: boolean;
    onToggleVerticalCollapse?: () => void;
  }

  const {
    embedded = false,
    isOpen,
    podRef,
    events,
    loading,
    error,
    focusedEventIndex,
    canVerticalCollapse = false,
    isVerticallyCollapsed = false,
    onToggleVerticalCollapse = () => {},
  }: PodEventsSheetProps = $props();

  let listContainer = $state<HTMLDivElement | null>(null);
  let isFullscreen = $state(false);

  $effect(() => {
    focusedEventIndex;
    if (focusedEventIndex === null || focusedEventIndex < 0) return;
    tick().then(() => {
      const target = listContainer?.querySelector<HTMLElement>(`[data-event-index="${focusedEventIndex}"]`);
      if (!target || !listContainer) return;
      const top = target.offsetTop - listContainer.clientHeight * 0.2;
      listContainer.scrollTop = Math.max(0, top);
    });
  });

  function getCollapsedLabel() {
    if (!podRef) return "Events";
    const segments = podRef.split("/");
    return segments[segments.length - 1] || podRef;
  }
</script>

<WorkbenchSheetShell
  {embedded}
  {isOpen}
  title={`Pod events: ${podRef || "-"}`}
  collapsedLabel={getCollapsedLabel()}
  standaloneMaxWidthClass="sm:max-w-[70vw]"
  {canVerticalCollapse}
  {isVerticallyCollapsed}
  {onToggleVerticalCollapse}
  {isFullscreen}
  onToggleFullscreen={() => {
    isFullscreen = !isFullscreen;
  }}
>
  <div class="min-h-0 flex-1 overflow-auto p-3" bind:this={listContainer}>
    {#if error}
      <div class="mb-2 rounded border border-rose-300/80 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/20 dark:text-rose-100">
        {error}
      </div>
    {/if}
    {#if loading}
      <div class="text-sm text-muted-foreground">Loading events<LoadingDots /></div>
    {:else if events.length === 0}
      <div class="text-sm text-muted-foreground">No events.</div>
    {:else}
      <div class="space-y-2">
        {#each events as event, index}
          <div
            data-event-index={index}
            class={`rounded border px-3 py-2 text-xs ${
              focusedEventIndex === index ? "border-primary bg-primary/10" : "border-border"
            }`}
          >
            <div class="font-medium">{event.reason} · {event.type}</div>
            <div class="text-muted-foreground">{event.lastTimestamp} · {event.source} · x{event.count}</div>
            <div class="mt-1 whitespace-pre-wrap break-words">{event.message}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</WorkbenchSheetShell>
