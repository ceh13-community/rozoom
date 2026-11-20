<script lang="ts">
  import { tick } from "svelte";
  import type { Snippet } from "svelte";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import X from "@lucide/svelte/icons/x";
  import { WorkbenchHeader } from "$features/pods-workbench";
  import { NAV_ACTIVE_CLASS } from "./nav-active";
  import { workbenchPaneBadges } from "$shared/lib/workbench-pane-badges";

  export type MultiPaneWorkbenchLayout = "single" | "dual" | "triple";

  interface TimelineMarker {
    id: string;
    ts: number | string;
    label: string;
    detail?: string;
    [key: string]: unknown;
  }

  interface TabItem {
    id: string;
    title: string;
    subtitle?: string;
    [key: string]: unknown;
  }

  interface Props {
    tabs: TabItem[];
    activeTabId: string | null;
    isTabPinned: (tabId: string) => boolean;
    onActivateTab: (tabId: string) => void;
    onTogglePin: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onReopenLastClosedTab: () => void;
    reopenDisabled?: boolean;
    layout: MultiPaneWorkbenchLayout;
    onLayoutChange: (layout: MultiPaneWorkbenchLayout) => void;
    fullscreen: boolean;
    onToggleFullscreen: () => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
    showTimeline?: boolean;
    timelineDensity?: "all" | "warnings";
    onTimelineDensityChange?: (density: "all" | "warnings") => void;
    timelineMarkers?: TimelineMarker[];
    activeTimelineMarkerId?: string | null;
    onTimelineMarkerClick?: (marker: TimelineMarker) => void;
    timelineEmptyLabel?: string;
    tabActions?: Snippet<[any]>;
    /** Tab id shown in each pane, so the tab strip can badge the pane number. */
    paneTabIds?: ReadonlyArray<string | null>;
    body: Snippet;
  }

  let {
    tabs,
    activeTabId,
    isTabPinned,
    onActivateTab,
    onTogglePin,
    onCloseTab,
    onReopenLastClosedTab,
    reopenDisabled = false,
    layout,
    onLayoutChange,
    fullscreen,
    onToggleFullscreen,
    collapsed,
    onToggleCollapse,
    showTimeline = false,
    timelineDensity = "all",
    onTimelineDensityChange,
    timelineMarkers = [],
    activeTimelineMarkerId = null,
    onTimelineMarkerClick,
    timelineEmptyLabel = "No warning markers",
    tabActions,
    paneTabIds = [],
    body,
  }: Props = $props();

  const LAYOUT_OPTIONS: Array<{ value: MultiPaneWorkbenchLayout; label: string; panes: number }> = [
    { value: "single", label: "1", panes: 1 },
    { value: "dual", label: "2", panes: 2 },
    { value: "triple", label: "3", panes: 3 },
  ];
  const visiblePaneCount = $derived(
    LAYOUT_OPTIONS.find((option) => option.value === layout)?.panes ?? 1,
  );
  const paneBadges = $derived(workbenchPaneBadges(paneTabIds, visiblePaneCount));

  let rootEl = $state<HTMLDivElement | null>(null);
  let prevActiveTabId: string | null = null;
  let pendingScrollTabId: string | null = null;

  // Scroll workbench into view when a tab is activated (user clicked edit/logs/investigate).
  // Two-phase approach: if the workbench is still collapsed when the tab changes,
  // store the intent and scroll once it expands.
  $effect(() => {
    const tabId = activeTabId;
    if (tabId && tabId !== prevActiveTabId) {
      prevActiveTabId = tabId;
      if (!collapsed && rootEl) {
        pendingScrollTabId = null;
        tick().then(() => {
          rootEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      } else {
        // Workbench is collapsed or not yet mounted - defer scroll
        pendingScrollTabId = tabId;
      }
    } else {
      prevActiveTabId = tabId;
    }
  });

  // Flush deferred scroll once collapsed becomes false
  $effect(() => {
    if (!collapsed && pendingScrollTabId && rootEl) {
      pendingScrollTabId = null;
      tick().then(() => {
        rootEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  });

  function formatMarkerTime(ts: number | string) {
    return new Date(ts).toLocaleTimeString();
  }
</script>

<div
  bind:this={rootEl}
  class={`overflow-hidden bg-card pointer-events-auto ${
    fullscreen
      ? "fixed inset-0 z-[120] mb-0 flex h-[100dvh] w-[100vw] flex-col rounded-none border-0 shadow-none"
      : "relative z-[100] mb-4 rounded-lg border shadow-sm"
  }`}
>
  <WorkbenchHeader {tabs}>
    {#snippet renderTab(tab)}
      <button
        type="button"
        class={`inline-flex min-h-10 max-w-[24rem] shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded px-4 py-2.5 text-sm transition ${
          tab.id === activeTabId
            ? `${NAV_ACTIVE_CLASS} font-medium shadow-sm`
            : "text-muted-foreground hover:bg-muted"
        }`}
        onclick={() => onActivateTab(tab.id)}
        aria-label={paneBadges.has(tab.id)
          ? `${tab.title}: ${tab.subtitle ?? ""}, pane ${paneBadges.get(tab.id)}`
          : undefined}
      >
        {#if paneBadges.has(tab.id)}
          <span
            class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-current px-1 text-xs font-semibold"
            title={`Shown in pane ${paneBadges.get(tab.id)}`}
            aria-hidden="true">{paneBadges.get(tab.id)}</span
          >
        {/if}
        <span class="inline-block max-w-[10rem] truncate">{tab.title}</span>
        <span class="inline-block max-w-[12rem] truncate text-xs opacity-70">{tab.subtitle}</span>
      </button>
      <button
        type="button"
        class={`rounded p-2 text-xs ${
          isTabPinned(tab.id)
            ? "bg-amber-100 text-amber-900"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        onclick={() => onTogglePin(tab.id)}
        title={isTabPinned(tab.id) ? `Unpin ${tab.title} tab` : `Pin ${tab.title} tab`}
        aria-label={isTabPinned(tab.id) ? `Unpin ${tab.title} tab` : `Pin ${tab.title} tab`}
      >
        {#if isTabPinned(tab.id)}
          <PinOff class="h-4 w-4" />
        {:else}
          <Pin class="h-4 w-4" />
        {/if}
      </button>
      {#if tabActions}
        {@render tabActions(tab)}
      {/if}
      <button
        type="button"
        class="rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30"
        onclick={() => onCloseTab(tab.id)}
        title="Close tab"
        aria-label={`Close ${tab.title} tab`}
      >
        <X class="h-4 w-4" />
      </button>
    {/snippet}
    {#snippet controls()}
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        onclick={onReopenLastClosedTab}
        disabled={reopenDisabled}
      >
        Reopen
      </button>
      <div class="inline-flex items-center gap-1" role="group" aria-label="Pane layout">
        <span class="text-xs text-muted-foreground">Panes</span>
        <div class="inline-flex items-center rounded border border-input bg-background p-0.5">
          {#each LAYOUT_OPTIONS as option (option.value)}
            <button
              type="button"
              class={`h-7 min-w-7 rounded px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                layout === option.value
                  ? `${NAV_ACTIVE_CLASS} font-semibold underline underline-offset-2`
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-pressed={layout === option.value}
              aria-label={option.panes === 1 ? "1 pane" : `${option.panes} panes`}
              title={option.panes === 1 ? "1 pane" : `${option.panes} panes`}
              onclick={() => {
                if (layout !== option.value) onLayoutChange(option.value);
              }}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>
      <button
        type="button"
        class={`rounded px-2 py-1 text-xs ${
          fullscreen
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        onclick={onToggleFullscreen}
      >
        {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        onclick={onToggleCollapse}
      >
        {collapsed ? "Expand" : "Collapse"}
      </button>
    {/snippet}
  </WorkbenchHeader>

  {#if showTimeline}
    <div class="flex items-center gap-2 border-b px-2 py-1.5">
      <span class="text-[11px] uppercase tracking-wide text-muted-foreground"
        >Incident timeline</span
      >
      <div class="inline-flex items-center rounded border bg-background p-1">
        <button
          type="button"
          class={`rounded px-2 py-1.5 text-[11px] ${
            timelineDensity === "all"
              ? NAV_ACTIVE_CLASS
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onclick={() => onTimelineDensityChange?.("all")}
        >
          All
        </button>
        <button
          type="button"
          class={`rounded px-2 py-1.5 text-[11px] ${
            timelineDensity === "warnings"
              ? NAV_ACTIVE_CLASS
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          onclick={() => onTimelineDensityChange?.("warnings")}
        >
          Warnings only
        </button>
      </div>
      <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {#if timelineMarkers.length === 0}
          <span class="text-xs text-muted-foreground">{timelineEmptyLabel}</span>
        {:else}
          {#each timelineMarkers as marker}
            <button
              type="button"
              class={`whitespace-nowrap rounded border px-2 py-1.5 text-[11px] ${
                activeTimelineMarkerId === marker.id
                  ? `border-primary ${NAV_ACTIVE_CLASS}`
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onclick={() => onTimelineMarkerClick?.(marker)}
              title={marker.detail}
            >
              {formatMarkerTime(marker.ts)} · {marker.label}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  {@render body()}
</div>
