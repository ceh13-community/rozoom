<script lang="ts">
  import { onMount } from "svelte";
  import { writable } from "svelte/store";
  import { computeLayoutClosePlan, orderPinnedTabs } from "$features/pods-workbench";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import type { DashboardDataProfileId } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    confirmWorkbenchLayoutShrink,
    confirmWorkbenchTabClose,
  } from "./common/workbench-confirm";
  import {
    buildDataModeWorkbenchStorageKey,
    normalizeWorkbenchVisibilityForDataMode,
  } from "./common/workbench-data-mode";

  type WorkbenchLayout = "single" | "dual" | "triple";
  type PaneTabId = "logs" | "yaml" | null;
  type AvailableTab = { id: "logs" | "yaml"; label: string };

  type LogsBookmark = {
    id: string;
    line: number;
    label: string;
    createdAt: number;
  };

  type LogsPanelState = {
    open: boolean;
    ref: string;
    text: string;
    loading: boolean;
    error: string | null;
    isLive: boolean;
    mode: "poll" | "stream-f";
    lastUpdatedAt: number | null;
    previous: boolean;
    selectedContainer: string;
    containerOptions: string[];
    bookmarks: LogsBookmark[];
    jumpToLine: number | null;
  };

  type YamlPanelState = {
    open: boolean;
    ref: string;
    originalYaml: string;
    yamlText: string;
    loading: boolean;
    saving: boolean;
    error: string | null;
  };

  interface WorkloadSimpleWorkbenchProps {
    storageKey: string;
    dataProfileId?: DashboardDataProfileId;
    logs: LogsPanelState;
    yaml: YamlPanelState;
    onCloseLogs: () => void;
    onCloseYaml: () => void;
    onOpenLogs?: () => void;
    onOpenYaml?: () => void;
    onToggleLogsLive: () => void;
    onSetLogsMode: (mode: "poll" | "stream-f") => void;
    onToggleLogsPrevious: () => void;
    onSelectLogsContainer: (container: string) => void;
    onRefreshLogs: () => void;
    onAddLogsBookmark: (line: number) => void;
    onRemoveLogsBookmark: (bookmarkId: string) => void;
    onLogsJumpHandled: () => void;
    onYamlChange: (value: string) => void;
    onRefreshYaml: () => void;
    onSaveYaml: () => void;
    logsSheet: any;
    yamlSheet: any;
  }

  const {
    storageKey,
    dataProfileId = "balanced",
    logs,
    yaml,
    onCloseLogs,
    onCloseYaml,
    onOpenLogs,
    onOpenYaml,
    onToggleLogsLive,
    onSetLogsMode,
    onToggleLogsPrevious,
    onSelectLogsContainer,
    onRefreshLogs,
    onAddLogsBookmark,
    onRemoveLogsBookmark,
    onLogsJumpHandled,
    onYamlChange,
    onRefreshYaml,
    onSaveYaml,
    logsSheet: LogsSheet,
    yamlSheet: YamlSheet,
  }: WorkloadSimpleWorkbenchProps = $props();

  const workbenchOpen = writable(true);
  let workbenchLayout = $state<WorkbenchLayout>("single");
  let paneTabIds = $state<[PaneTabId, PaneTabId, PaneTabId]>(["logs", "yaml", null]);
  let workbenchFullscreen = $state(false);
  let workbenchCollapsed = $state(false);
  let collapsedPaneIndexes = $state<number[]>([]);
  let activeTabId = $state<PaneTabId>("logs");
  let pinnedTabIds = $state(new Set<Exclude<PaneTabId, null>>());
  let closedTabs = $state<Array<{ id: Exclude<PaneTabId, null>; pinned: boolean }>>([]);
  let previousLogsOpen = $state(false);
  let previousYamlOpen = $state(false);
  let lastLoadedStorageKey = $state<string | null>(null);

  const scopedStorageKey = $derived(buildDataModeWorkbenchStorageKey(storageKey, dataProfileId));

  function getPaneCount() {
    if (workbenchLayout === "single") return 1;
    if (workbenchLayout === "dual") return 2;
    return 3;
  }

  function markTabClosed(tab: PaneTabId) {
    if (!tab) return;
    const entry = { id: tab, pinned: pinnedTabIds.has(tab) };
    closedTabs = [entry, ...closedTabs.filter((item) => item.id !== tab)].slice(0, 20);
  }

  function markTabOpened(tab: PaneTabId) {
    if (!tab) return;
    if (closedTabs.length > 0) {
      closedTabs = closedTabs.filter((entry) => entry.id !== tab);
    }
    setActiveTab(tab);
  }

  function isTabPinned(tabId: PaneTabId) {
    return tabId ? pinnedTabIds.has(tabId) : false;
  }

  function togglePinTab(tabId: PaneTabId) {
    if (!tabId) return;
    const next = new Set(pinnedTabIds);
    if (next.has(tabId)) {
      next.delete(tabId);
    } else {
      next.add(tabId);
    }
    pinnedTabIds = next;
  }

  async function closeLogsTab() {
    const confirmed = await confirmWorkbenchTabClose({
      kind: "logs",
      title: "Logs",
      subtitle: logs.ref,
    });
    if (!confirmed) return;
    markTabClosed("logs");
    pinnedTabIds = new Set([...pinnedTabIds].filter((id) => id !== "logs"));
    if (activeTabId === "logs") {
      activeTabId = yaml.open ? "yaml" : null;
    }
    onCloseLogs();
  }

  async function closeYamlTab() {
    const confirmed = await confirmWorkbenchTabClose({
      kind: "yaml",
      title: "YAML",
      subtitle: yaml.ref,
    });
    if (!confirmed) return;
    markTabClosed("yaml");
    pinnedTabIds = new Set([...pinnedTabIds].filter((id) => id !== "yaml"));
    if (activeTabId === "yaml") {
      activeTabId = logs.open ? "logs" : null;
    }
    onCloseYaml();
  }

  function reopenLastClosedTab() {
    const next = closedTabs[0] ?? null;
    if (!next) return;
    closedTabs = closedTabs.slice(1);
    if (next.id === "logs") {
      activeTabId = "logs";
      onOpenLogs?.();
    } else if (next.id === "yaml") {
      activeTabId = "yaml";
      onOpenYaml?.();
    }
    if (next.pinned) {
      pinnedTabIds = new Set([...pinnedTabIds, next.id]);
    }
  }

  function getPaneIndexes() {
    return Array.from({ length: getPaneCount() }, (_, idx) => idx as 0 | 1 | 2);
  }

  function getAvailableTabs() {
    const tabs: AvailableTab[] = [];
    if (logs.open) tabs.push({ id: "logs", label: "Logs" });
    if (yaml.open) tabs.push({ id: "yaml", label: "YAML" });
    return orderPinnedTabs(tabs, pinnedTabIds);
  }

  function getTabSubtitle(tabId: PaneTabId) {
    if (tabId === "logs") return logs.ref || "-";
    if (tabId === "yaml") return yaml.ref || "-";
    return "-";
  }

  function setActiveTab(tabId: PaneTabId) {
    if (!tabId) return;
    const ids = getAvailableTabs().map((tab) => tab.id);
    if (!ids.includes(tabId)) return;
    activeTabId = tabId;
    const next: [PaneTabId, PaneTabId, PaneTabId] = [...paneTabIds] as [
      PaneTabId,
      PaneTabId,
      PaneTabId,
    ];
    next[0] = tabId;
    paneTabIds = next;
  }

  function isPaneCollapsed(paneIndex: number) {
    return collapsedPaneIndexes.includes(paneIndex);
  }

  function canCollapsePane(paneIndex: number) {
    if (getPaneCount() <= 1) return false;
    const tabId = paneTabIds[paneIndex];
    return tabId === "logs" || tabId === "yaml";
  }

  function togglePaneCollapsed(paneIndex: number) {
    if (!canCollapsePane(paneIndex)) return;
    if (collapsedPaneIndexes.includes(paneIndex)) {
      collapsedPaneIndexes = collapsedPaneIndexes.filter((idx) => idx !== paneIndex);
      return;
    }
    const paneCount = getPaneCount();
    const expandedCount = paneCount - collapsedPaneIndexes.length;
    if (expandedCount <= 1) return;
    collapsedPaneIndexes = [...collapsedPaneIndexes, paneIndex];
  }

  function getPaneWrapperClass(paneIndex: number) {
    if (isPaneCollapsed(paneIndex)) {
      return "flex-none basis-[300px] border-dashed";
    }
    return "flex-1";
  }

  async function requestWorkbenchLayout(nextLayout: WorkbenchLayout) {
    if (nextLayout === workbenchLayout) return;
    const nextPaneCount = nextLayout === "single" ? 1 : nextLayout === "dual" ? 2 : 3;
    const { occupiedRemovedPaneCount } = computeLayoutClosePlan(paneTabIds, nextPaneCount);
    if (occupiedRemovedPaneCount > 0) {
      const confirmed = await confirmWorkbenchLayoutShrink();
      if (!confirmed) return;
    }
    workbenchLayout = nextLayout;
  }

  function arraysEqual(left: number[], right: number[]) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  function ensurePaneAssignments() {
    const availableList = getAvailableTabs()
      .map((tab) => tab.id)
      .filter((tab): tab is "logs" | "yaml" => Boolean(tab));
    const available = new Set<"logs" | "yaml">(availableList);
    if (!activeTabId || !available.has(activeTabId)) {
      activeTabId = availableList[0] ?? null;
    }
    const current = paneTabIds;
    const next: [PaneTabId, PaneTabId, PaneTabId] = [...current] as [
      PaneTabId,
      PaneTabId,
      PaneTabId,
    ];
    for (const idx of [0, 1, 2] as const) {
      if (next[idx] && !available.has(next[idx])) {
        next[idx] = null;
      }
    }
    if (!next[0] || !available.has(next[0])) {
      next[0] =
        activeTabId ?? (available.has("logs") ? "logs" : available.has("yaml") ? "yaml" : null);
    }
    if (next[1] === null && getPaneCount() > 1) {
      if (available.has("yaml") && next[0] !== "yaml") next[1] = "yaml";
      else if (available.has("logs") && next[0] !== "logs") next[1] = "logs";
    }
    if (next[2] === null && getPaneCount() > 2) next[2] = null;
    if (next[0] !== current[0] || next[1] !== current[1] || next[2] !== current[2]) {
      paneTabIds = next;
    }
    const paneCount = getPaneCount();
    const filteredCollapsed = collapsedPaneIndexes.filter(
      (idx) => idx >= 0 && idx < paneCount && Boolean(next[idx]),
    );
    if (!arraysEqual(filteredCollapsed, collapsedPaneIndexes)) {
      collapsedPaneIndexes = filteredCollapsed;
    }
  }

  function loadState(storageKeyToLoad: string, fallbackStorageKey?: string) {
    if (typeof window === "undefined") return;
    try {
      const raw =
        window.localStorage.getItem(storageKeyToLoad) ??
        (fallbackStorageKey ? window.localStorage.getItem(fallbackStorageKey) : null);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        layout?: WorkbenchLayout;
        paneTabIds?: Array<PaneTabId>;
        fullscreen?: boolean;
        collapsed?: boolean;
        collapsedPaneIndexes?: number[];
        activeTabId?: PaneTabId;
        pinnedTabIds?: string[];
        closedTabs?: Array<{ id?: string; pinned?: boolean }>;
      };
      if (parsed.layout === "single" || parsed.layout === "dual" || parsed.layout === "triple") {
        workbenchLayout = parsed.layout;
      }
      if (Array.isArray(parsed.paneTabIds)) {
        paneTabIds = [
          parsed.paneTabIds[0] === "logs" || parsed.paneTabIds[0] === "yaml"
            ? parsed.paneTabIds[0]
            : null,
          parsed.paneTabIds[1] === "logs" || parsed.paneTabIds[1] === "yaml"
            ? parsed.paneTabIds[1]
            : null,
          parsed.paneTabIds[2] === "logs" || parsed.paneTabIds[2] === "yaml"
            ? parsed.paneTabIds[2]
            : null,
        ];
      }
      workbenchFullscreen = false;
      const normalizedVisibility = normalizeWorkbenchVisibilityForDataMode(dataProfileId, {
        workbenchCollapsed: Boolean(parsed.collapsed),
        collapsedPaneIndexes: Array.isArray(parsed.collapsedPaneIndexes)
          ? parsed.collapsedPaneIndexes.filter(
              (idx) => Number.isInteger(idx) && idx >= 0 && idx <= 2,
            )
          : [],
      });
      workbenchCollapsed = normalizedVisibility.workbenchCollapsed;
      if (Array.isArray(parsed.collapsedPaneIndexes)) {
        collapsedPaneIndexes = normalizedVisibility.collapsedPaneIndexes;
      }
      if (parsed.activeTabId === "logs" || parsed.activeTabId === "yaml") {
        activeTabId = parsed.activeTabId;
      }
      if (Array.isArray(parsed.pinnedTabIds)) {
        pinnedTabIds = new Set(
          parsed.pinnedTabIds.filter((id): id is "logs" | "yaml" => id === "logs" || id === "yaml"),
        );
      }
      if (Array.isArray(parsed.closedTabs)) {
        closedTabs = parsed.closedTabs
          .map((entry) => ({
            id: entry.id === "logs" || entry.id === "yaml" ? entry.id : null,
            pinned: Boolean(entry.pinned),
          }))
          .filter((entry): entry is { id: "logs" | "yaml"; pinned: boolean } => Boolean(entry.id));
      }
    } catch {
      // Ignore invalid payload.
    }
  }

  function persistState() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        scopedStorageKey,
        JSON.stringify({
          layout: workbenchLayout,
          paneTabIds,
          fullscreen: workbenchFullscreen,
          collapsed: workbenchCollapsed,
          collapsedPaneIndexes,
          activeTabId,
          pinnedTabIds: [...pinnedTabIds],
          closedTabs,
        }),
      );
      if (scopedStorageKey !== storageKey) {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      // Ignore localStorage failures.
    }
  }

  onMount(() => {
    loadState(scopedStorageKey, storageKey);
    lastLoadedStorageKey = scopedStorageKey;
    ensurePaneAssignments();
    previousLogsOpen = logs.open;
    previousYamlOpen = yaml.open;
  });

  $effect(() => {
    logs.open;
    yaml.open;
    workbenchLayout;
    ensurePaneAssignments();
  });

  $effect(() => {
    const currentLogsOpen = logs.open;
    const currentYamlOpen = yaml.open;
    if (currentLogsOpen && !previousLogsOpen) markTabOpened("logs");
    if (currentYamlOpen && !previousYamlOpen) markTabOpened("yaml");
    previousLogsOpen = currentLogsOpen;
    previousYamlOpen = currentYamlOpen;
  });

  $effect(() => {
    if (lastLoadedStorageKey === scopedStorageKey) return;
    loadState(scopedStorageKey, storageKey);
    lastLoadedStorageKey = scopedStorageKey;
  });

  $effect(() => {
    const normalizedVisibility = normalizeWorkbenchVisibilityForDataMode(dataProfileId, {
      workbenchCollapsed,
      collapsedPaneIndexes,
    });
    if (normalizedVisibility.workbenchCollapsed !== workbenchCollapsed) {
      workbenchCollapsed = normalizedVisibility.workbenchCollapsed;
    }
    if (!arraysEqual(normalizedVisibility.collapsedPaneIndexes, collapsedPaneIndexes)) {
      collapsedPaneIndexes = normalizedVisibility.collapsedPaneIndexes;
    }
  });

  $effect(() => {
    workbenchLayout;
    paneTabIds;
    workbenchFullscreen;
    workbenchCollapsed;
    collapsedPaneIndexes;
    activeTabId;
    pinnedTabIds;
    closedTabs;
    persistState();
  });
</script>

{#if logs.open || yaml.open}
  <MultiPaneWorkbench
    tabs={getAvailableTabs().map((tab) => ({
      id: tab.id,
      title: tab.label,
      subtitle: getTabSubtitle(tab.id),
    }))}
    {activeTabId}
    isTabPinned={(tabId) => isTabPinned(tabId === "logs" || tabId === "yaml" ? tabId : null)}
    onActivateTab={(tabId) => {
      if (tabId === "logs" || tabId === "yaml") setActiveTab(tabId);
    }}
    onTogglePin={(tabId) => {
      if (tabId === "logs" || tabId === "yaml") togglePinTab(tabId);
    }}
    onCloseTab={(tabId) => {
      if (tabId === "logs") closeLogsTab();
      else closeYamlTab();
    }}
    onReopenLastClosedTab={reopenLastClosedTab}
    reopenDisabled={closedTabs.length === 0}
    layout={workbenchLayout}
    onLayoutChange={(nextLayout) => {
      void requestWorkbenchLayout(nextLayout);
    }}
    fullscreen={workbenchFullscreen}
    onToggleFullscreen={() => (workbenchFullscreen = !workbenchFullscreen)}
    collapsed={workbenchCollapsed}
    onToggleCollapse={() => (workbenchCollapsed = !workbenchCollapsed)}
  >
    {#snippet body()}
      {#if !workbenchCollapsed}
        <div class={workbenchFullscreen ? "min-h-0 flex-1" : "h-[min(70dvh,760px)] min-h-[430px]"}>
          <div class="flex h-full gap-2 p-2">
            {#each getPaneIndexes() as paneIndex}
              <div
                class={`${getPaneWrapperClass(paneIndex)} min-h-0 overflow-hidden rounded border`}
              >
                <div class="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                  <span class="text-muted-foreground">Pane {paneIndex + 1}</span>
                  <select
                    class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={paneTabIds[paneIndex] ?? ""}
                    onchange={(event) => {
                      const value = event.currentTarget.value;
                      const next: [PaneTabId, PaneTabId, PaneTabId] = [...paneTabIds] as [
                        PaneTabId,
                        PaneTabId,
                        PaneTabId,
                      ];
                      const nextTab = value === "logs" || value === "yaml" ? value : null;
                      next[paneIndex] = nextTab;
                      if (paneIndex === 0 && nextTab) {
                        activeTabId = nextTab;
                      }
                      paneTabIds = next;
                    }}
                  >
                    <option value="">Select tab</option>
                    {#if logs.open}
                      <option value="logs">Logs</option>
                    {/if}
                    {#if yaml.open}
                      <option value="yaml">YAML</option>
                    {/if}
                  </select>
                </div>

                {#if paneTabIds[paneIndex] === "logs" && logs.open}
                  <LogsSheet
                    embedded={true}
                    isOpen={workbenchOpen}
                    podRef={logs.ref}
                    logs={logs.text}
                    loading={logs.loading}
                    error={logs.error}
                    isLive={logs.isLive}
                    mode={logs.mode}
                    lastUpdatedAt={logs.lastUpdatedAt}
                    previous={logs.previous}
                    selectedContainer={logs.selectedContainer}
                    containerOptions={logs.containerOptions}
                    bookmarks={logs.bookmarks}
                    canVerticalCollapse={getPaneCount() > 1}
                    isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                    onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                    onToggleLive={onToggleLogsLive}
                    onSetMode={onSetLogsMode}
                    onTogglePrevious={onToggleLogsPrevious}
                    onSelectContainer={onSelectLogsContainer}
                    onRefresh={onRefreshLogs}
                    onAddBookmark={onAddLogsBookmark}
                    onRemoveBookmark={onRemoveLogsBookmark}
                    jumpToLine={logs.jumpToLine}
                    onJumpHandled={onLogsJumpHandled}
                  />
                {:else if paneTabIds[paneIndex] === "yaml" && yaml.open}
                  <YamlSheet
                    embedded={true}
                    isOpen={workbenchOpen}
                    podRef={yaml.ref}
                    originalYaml={yaml.originalYaml}
                    yamlText={yaml.yamlText}
                    loading={yaml.loading}
                    saving={yaml.saving}
                    hasChanges={yaml.yamlText !== yaml.originalYaml}
                    error={yaml.error}
                    canVerticalCollapse={getPaneCount() > 1}
                    isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                    onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                    {onYamlChange}
                    onRefresh={onRefreshYaml}
                    onSave={onSaveYaml}
                  />
                {:else}
                  <div
                    class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground"
                  >
                    Select tab for pane {paneIndex + 1}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/snippet}
  </MultiPaneWorkbench>
{/if}
