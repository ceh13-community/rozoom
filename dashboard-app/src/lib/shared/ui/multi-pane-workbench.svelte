<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { isTypingOutside, restoreFocus, revealResult } from "$shared/lib/reveal-result";
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
    /**
     * Changes on every row action that opened or re-opened a tab (Logs, YAML, ...): the
     * panel is revealed and focused even when that tab was already active.
     */
    revealToken?: number | null;
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
    revealToken = null,
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

  // Reveal on each request token: scroll so the panel is visible (its top when it is taller
  // than the screen) and move focus to it. The element that had focus is kept, so closing
  // the panel gives focus back to the row menu that opened it.
  let lastRevealToken: number | null = null;
  let pendingRevealToken: number | null = null;
  let revealTrigger: Element | null = null;

  function revealPanel() {
    const root = rootEl;
    if (!root) return;
    const active = document.activeElement;
    // The request behind the reveal may take seconds: no scroll and no focus when the
    // person has started typing somewhere else meanwhile.
    if (isTypingOutside(active, root)) return;
    if (active && !root.contains(active)) revealTrigger = active;
    revealResult(root);
  }

  $effect(() => {
    const token = revealToken;
    if (token === null || token === lastRevealToken) return;
    lastRevealToken = token;
    if (collapsed || !rootEl) {
      pendingRevealToken = token;
      return;
    }
    pendingRevealToken = null;
    void tick().then(revealPanel);
  });

  $effect(() => {
    if (!collapsed && pendingRevealToken !== null && rootEl) {
      pendingRevealToken = null;
      void tick().then(revealPanel);
    }
  });

  function returnFocus() {
    const root = rootEl;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || (root?.contains(active) ?? false);
    if (focusLost) restoreFocus(revealTrigger);
  }

  function closeActiveTabFromKeyboard(event: KeyboardEvent) {
    // Esc on the panel itself (where reveal put focus) closes the active tab. Esc inside an
    // editor or a field stays theirs.
    if (event.key !== "Escape" || event.target !== rootEl || !activeTabId) return;
    event.preventDefault();
    // Focus goes back to the row menu when the panel goes away (onDestroy); a cancelled
    // close keeps it on the panel.
    onCloseTab(activeTabId);
  }

  onDestroy(returnFocus);

  const activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) ?? null);
  const regionLabel = $derived(
    activeTab
      ? [activeTab.title, activeTab.subtitle].filter(Boolean).join(": ")
      : "Workbench",
  );

  function formatMarkerTime(ts: number | string) {
    return new Date(ts).toLocaleTimeString();
  }
</script>

<!-- The region takes focus after a row action; Esc on it closes the active tab. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={rootEl}
  tabindex="-1"
  role="region"
  aria-label={regionLabel}
  onkeydown={closeActiveTabFromKeyboard}
  class={`overflow-hidden bg-card pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    fullscreen
      ? "fixed inset-0 z-[120] mb-0 flex h-[100dvh] w-[100vw] flex-col rounded-none border-0 shadow-none"
      : "relative z-[100] mb-4 scroll-mt-32 rounded-lg border shadow-sm"
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
