<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import { onDestroy, onMount } from "svelte";
  import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Target from "@lucide/svelte/icons/target";
  import X from "@lucide/svelte/icons/x";
  import type { ColumnDef } from "@tanstack/table-core";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import {
    applyStatefulSetEvent,
    destroyStatefulSetsSync,
    initStatefulSetsSync,
    markStatefulSetsSyncError,
    markStatefulSetsSyncLoading,
    markStatefulSetsSyncSuccess,
    resetStatefulSetsSyncStatus,
    selectClusterStatefulSets,
    setInitialStatefulSets,
    setStatefulSetsSyncEnabled,
  } from "$features/check-health";
  import { selectedNamespace } from "$features/namespace-management";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import {
    buildYamlFilename,
    buildIncidentTimeline,
    computeLayoutClosePlan,
    orderPinnedTabs,
    type IncidentMarker,
  } from "$features/pods-workbench";
  import {
    kubectlRawArgsFront,
    kubectlStreamArgsFront,
    type KubectlStreamProcess,
  } from "$shared/api/kubectl-proxy";
  import { openStreamWithOptionalFallback } from "$features/pods-workbench";
  import { getTimeDifference } from "$shared";
  import { renderComponent } from "$shared/ui/data-table";
  import { Button, SortingButton } from "$shared/ui/button";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import { confirmAction } from "$shared/lib/confirm-action";
  import * as Alert from "$shared/ui/alert";
  import type { StatefulSetItem } from "$shared/model/clusters";
  import DataTable, {
    type StatefulSetsTableViewMode,
  } from "./stateful-sets-list/data-table.svelte";
  import ResourceLogsSheet from "./common/resource-logs-sheet.svelte";
  import ResourceYamlSheet from "./common/resource-yaml-sheet.svelte";
  import ResourceDetailsSheet from "./resource-details-sheet.svelte";
  import WorkloadCommandOutputSheet from "./common/workload-command-output-sheet.svelte";
  import WorkloadEventsSheet from "./common/workload-events-sheet.svelte";
  import { loadWorkloadEvents, type WorkloadEvent } from "./common/workload-events";
  import { buildRolloutCommandArgs, loadRolloutCommandOutput, type RolloutCommandMode } from "./common/workload-rollout";
  import { writable } from "svelte/store";
  import {
    findStatefulSetItem,
    getFilteredStatefulSets,
    mapStatefulSetRows,
    pruneSelectedStatefulSetIds,
    type StatefulSetRow,
  } from "./stateful-sets-list/model";
  import StatefulSetActionsMenu from "./stateful-sets-list/statefulset-actions-menu.svelte";
  import StatefulSetBulkActions from "./stateful-sets-list/statefulset-bulk-actions.svelte";
  import StatefulSetPodsBadge from "./stateful-sets-list/statefulset-pods-badge.svelte";
  import StatefulSetSelectionCheckbox from "./stateful-sets-list/statefulset-selection-checkbox.svelte";
  import {
    getStatefulSetsWorkbenchStateKey,
    parseStatefulSetsWorkbenchState,
    type PersistedStatefulSetsWorkbenchState,
  } from "./stateful-sets-list/workbench-session";
  import { buildKubectlDescribeCommand } from "./common/kubectl-command-builder";
  import { fetchNamespacedSnapshotItems } from "./common/namespaced-snapshot";
  import { createWorkloadWatcher } from "./common/workload-watcher";
  import { createDetailsActionManager } from "./common/details-action-manager";
  import { createMutationReconcile } from "./common/workload-mutation-reconcile";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
    resolveCoreResourceSyncPolicy,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import { invalidateWorkloadSnapshotCache } from "./common/workload-cache-invalidation";
  import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";
  import SectionRuntimeStatus from "./common/section-runtime-status.svelte";
  import WorkloadSelectionBar from "./common/workload-selection-bar.svelte";
  import {
    confirmWorkbenchLayoutShrink,
    confirmWorkbenchTabClose,
  } from "./common/workbench-confirm";

  interface StatefulSetsListProps {
    data: PageData & { statefulsets?: StatefulSetItem[] };
  }

  const { data }: StatefulSetsListProps = $props();
  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
    viewMode: StatefulSetsTableViewMode;
  };
  const WATCHER_SETTINGS_PREFIX = "dashboard.statefulsets.watcher.settings.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 30,
    viewMode: "flat",
  };
  type LogsBookmark = {
    id: string;
    line: number;
    label: string;
    createdAt: number;
  };
  type WorkbenchLayout = "single" | "dual" | "triple";
  type WorkbenchTab = {
    id: string;
    kind: "logs" | "yaml" | "events" | "rollout-status" | "rollout-history";
    title: string;
    subtitle: string;
  };
  type ClosedWorkbenchTab = {
    kind: "logs" | "yaml" | "events" | "rollout-status" | "rollout-history";
    target: { name: string; namespace: string } | null;
    pinned: boolean;
  };
  type LogsTabState = {
    id: string;
    target: { name: string; namespace: string };
    logsText: string;
    logsError: string | null;
    logsLoading: boolean;
    logsLive: boolean;
    logsMode: "poll" | "stream-f";
    logsUpdatedAt: number | null;
    logsPrevious: boolean;
    logsContainerOptions: string[];
    logsSelectedContainer: string;
    bookmarks: LogsBookmark[];
  };
  type YamlTabState = {
    id: string;
    target: { name: string; namespace: string };
    yamlLoading: boolean;
    yamlSaving: boolean;
    yamlError: string | null;
    yamlText: string;
    yamlOriginalText: string;
  };
  type EventsTabState = {
    id: string;
    target: { name: string; namespace: string };
    events: WorkloadEvent[];
    eventsLoading: boolean;
    eventsError: string | null;
  };
  type RolloutTabState = {
    id: string;
    target: { name: string; namespace: string };
    mode: RolloutCommandMode;
    output: string;
    loading: boolean;
    error: string | null;
  };

  const columns: ColumnDef<StatefulSetRow>[] = [
    {
      accessorFn: (row) => row.problemScore,
      id: "problemScore",
      header: "Problem",
      enableHiding: false,
      cell: () => "",
    },
    {
      id: "select",
      header: () => {
        return renderComponent(StatefulSetSelectionCheckbox, {
          checked: allSelected,
          indeterminate: hasSomeSelected,
          label: "Select all stateful sets",
          onToggle: (next: boolean) => toggleAllSelection(next),
        });
      },
      cell: ({ row }) => {
        return renderComponent(StatefulSetSelectionCheckbox, {
          checked: isStatefulSetSelected(row.original.uid),
          label: `Select stateful set ${row.original.name}`,
          onToggle: (next: boolean) => {
            toggleStatefulSetSelection(row.original.uid, next);
          },
        });
      },
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const statefulSet = findStatefulSetItem(statefulSetsSnapshot, row.original);
        return renderComponent(StatefulSetActionsMenu, {
          name: row.original.name,
          namespace: row.original.namespace,
          disabled: !statefulSet,
          isBusy: actionInFlight,
          onShowDetails: () => {
            if (statefulSet) openSheet(statefulSet);
          },
          onLogs: () => {
            if (statefulSet) openLogsForStatefulSet(statefulSet);
          },
          onEvents: () => {
            if (statefulSet) void openEventsForStatefulSet(statefulSet);
          },
          onScale: () => {
            if (statefulSet) void scaleStatefulSets([statefulSet]);
          },
          onEditYaml: () => {
            if (statefulSet) openYamlForStatefulSet(statefulSet);
          },
          onInvestigate: () => {
            if (statefulSet) openStatefulSetInvestigationWorkspace(statefulSet);
          },
          onCopyDescribe: () => {
            if (statefulSet) void copyDescribeCommandForStatefulSet(statefulSet);
          },
          onRunDebugDescribe: () => {
            if (statefulSet) openDebugDescribeForStatefulSet(statefulSet);
          },
          onRolloutStatus: () => {
            if (statefulSet) void openRolloutCommandForStatefulSet("status", statefulSet);
          },
          onRolloutHistory: () => {
            if (statefulSet) void openRolloutCommandForStatefulSet("history", statefulSet);
          },
          onRestart: () => {
            if (statefulSet) void restartStatefulSets([statefulSet]);
          },
          onDownloadYaml: () => {
            if (statefulSet) void downloadYamlForStatefulSets([statefulSet]);
          },
          onDelete: () => {
            if (statefulSet) void deleteStatefulSets([statefulSet]);
          },
        });
      },
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Name",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "namespace", header: "Namespace" },
    {
      accessorKey: "pods",
      header: "Pods",
      cell: ({ row }) =>
        renderComponent(StatefulSetPodsBadge, {
          pods: row.original.pods,
        }),
    },
    { accessorKey: "replicas", header: "Replicas" },
    {
      accessorKey: "age",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Age",
          onclick: column.getToggleSortingHandler(),
        }),
    },
  ];

  let statefulSetsSnapshot = $state<StatefulSetItem[]>([]);
  let selectedStatefulSetIds = $state(new Set<string>());
  const statefulSets = $derived.by(() => {
    return getFilteredStatefulSets(statefulSetsSnapshot, $selectedNamespace);
  });
  const rows = $derived.by(() =>
    mapStatefulSetRows(statefulSets, (creationTimestamp) =>
      getTimeDifference(
        creationTimestamp
          ? creationTimestamp instanceof Date
            ? creationTimestamp
            : new Date(creationTimestamp)
          : undefined,
      ),
    ),
  );
  const availableIds = $derived(rows.map((item) => item.uid).filter(Boolean));
  const allSelected = $derived(
    availableIds.length > 0 && availableIds.every((id) => selectedStatefulSetIds.has(id)),
  );
  const hasSomeSelected = $derived(selectedStatefulSetIds.size > 0 && !allSelected);
  const selectedCount = $derived(selectedStatefulSetIds.size);
  const selectedStatefulSets = $derived.by(() => {
    const selected = new Set(selectedStatefulSetIds);
    return statefulSets.filter((item) => {
      const namespace = item.metadata?.namespace ?? "default";
      const name = item.metadata?.name ?? "-";
      return selected.has(`${namespace}/${name}`);
    });
  });
  const selectedItem = writable<StatefulSetItem | null>(null);
  const isSheetOpen = writable(false);
  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let statefulSetsTableViewMode = $state<StatefulSetsTableViewMode>(DEFAULT_WATCHER_SETTINGS.viewMode);
  let watcherError = $state<string | null>(null);
  let lastWatcherSuccessAt = $state<number | null>(null);
  let runtimeClockNow = $state(Date.now());
  let watcherInFlight = $state(false);
  let watcherSettingsLoadedCluster = $state<string | null>(null);
  let statefulSetsSyncStarted = false;
  let statefulSetsSyncStoreUnsubscribe: (() => void) | null = null;
  const watcherPolicy = $derived.by(() =>
    resolveCoreResourceSyncPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
      supportsStream: true,
    }),
  );
  const watcherEngine = createWorkloadWatcher({
    workloadName: "statefulsets",
    isEnabled: () => watcherPolicy.enabled,
    getRefreshSeconds: () => watcherPolicy.refreshSeconds,
    onTick: async () => {
      await refreshStatefulSetsFromWatcher();
    },
  });
  const mutationReconcile = createMutationReconcile({
    isSyncEnabled: () => watcherPolicy.enabled,
    getSyncMode: () => watcherPolicy.mode,
    getClusterId: () => data?.slug ?? null,
    getScopeKey: () => "statefulset",
    refresh: () => refreshStatefulSetsFromWatcher(),
  });
  const detailsActions = createDetailsActionManager();
  let detailsLoading = $state(false);
  let detailsError = $state<string | null>(null);
  let detailsEvents = $state<
    Array<{ type: string; reason: string; message: string; lastTimestamp: string }>
  >([]);
  let detailsKeyLoaded = $state<string | null>(null);
  let actionInFlight = $state(false);
  import { notifySuccess, notifyError, type ActionNotification } from "$shared/lib/action-notification";
  let actionNotification = $state<ActionNotification>(null);
  
  let yamlDownloadError = $state<string | null>(null);
  let yamlDownloadMessage = $state<string | null>(null);
  const workbenchOpen = writable(true);
  let workbenchTabs = $state<WorkbenchTab[]>([]);
  let activeWorkbenchTabId = $state<string | null>(null);
  let workbenchLayout = $state<WorkbenchLayout>("single");
  let paneTabIds = $state<[string | null, string | null, string | null]>([null, null, null]);
  let collapsedPaneIndexes = $state<number[]>([]);
  let workbenchFullscreen = $state(false);
  let workbenchCollapsed = $state(false);
  let pinnedTabIds = $state(new Set<string>());
  let closedWorkbenchTabs = $state<ClosedWorkbenchTab[]>([]);
  let logsTabs = $state<LogsTabState[]>([]);
  let yamlTabs = $state<YamlTabState[]>([]);
  let eventsTabs = $state<EventsTabState[]>([]);
  let rolloutTabs = $state<RolloutTabState[]>([]);
  let logsLiveTimers = new Map<string, ReturnType<typeof setInterval>>();
  let logsStreamProcesses = new Map<string, KubectlStreamProcess>();
  let logsStreamReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let logsStreamTokens = new Map<string, number>();
  const watcherStaleThresholdMs = $derived(watcherPolicy.refreshSeconds * 2000);
  const watcherFreshnessAgeMs = $derived(
    lastWatcherSuccessAt ? Date.now() - lastWatcherSuccessAt : Number.POSITIVE_INFINITY,
  );
  const watcherIsStale = $derived(
    watcherPolicy.enabled &&
      Number.isFinite(watcherFreshnessAgeMs) &&
      watcherFreshnessAgeMs > watcherStaleThresholdMs,
  );
  const statefulSetsRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const statefulSetsRuntimeSourceState = $derived.by(() => {
    if (!watcherPolicy.enabled) return "paused";
    if (watcherError && statefulSetsSnapshot.length > 0) return "cached";
    if (watcherError) return "error";
    if (watcherIsStale) return "stale";
    if (watcherInFlight && statefulSetsSnapshot.length > 0) return "cached";
    if (lastWatcherSuccessAt) return "live";
    if (statefulSetsSnapshot.length > 0) return "cached";
    return "idle";
  });
  const statefulSetsRuntimeLastUpdatedLabel = $derived.by(() => {
    void runtimeClockNow;
    if (!lastWatcherSuccessAt) return null;
    return `updated ${getTimeDifference(new Date(lastWatcherSuccessAt))} ago`;
  });
  const statefulSetsRuntimeDetail = $derived.by(() => {
    if (!watcherPolicy.enabled) {
      return "StatefulSet sync is paused until you refresh or re-enable the watcher.";
    }
    if (watcherError && statefulSetsSnapshot.length > 0) {
      return "Showing the last successful StatefulSet snapshot while background refresh is degraded.";
    }
    if (watcherError) return "StatefulSet sync is degraded and needs operator attention.";
    if (watcherIsStale) return "StatefulSet data has exceeded the freshness budget and should be refreshed.";
    if (watcherInFlight) return "Background StatefulSet refresh is currently in flight.";
    return "StatefulSet sync is operating within the current runtime budget.";
  });
  const statefulSetsRuntimeReason = $derived.by(() => {
    if (watcherError) return watcherError;
    return watcherPolicy.mode === "stream"
      ? "Streaming watcher active for stateful sets."
      : `Polling stateful sets every ${watcherPolicy.refreshSeconds}s.`;
  });
  const statefulSetsNamespaceSummary = $derived($selectedNamespace || "all");
  const statefulSetsSummaryView = $derived(
    statefulSetsTableViewMode === "namespace" ? "By namespace" : "Flat",
  );
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);
  let incidentTimelineCursorId = $state<string | null>(null);
  let incidentTimelineDensity = $state<"all" | "warnings">("all");
  let pendingWorkbenchState = $state<PersistedStatefulSetsWorkbenchState | null | undefined>(undefined);
  let workbenchStateRestored = $state(false);
  let workbenchRecoveryAttemptedKey = $state<string | null>(null);
  let logsJumpToLine = $state<number | null>(null);
  const logsLivePollMs = 2_000;
  const logsStreamReconnectMs = 1_200;
  const logsMaxChars = 1_000_000;
  const orderedWorkbenchTabs = $derived.by(() => orderPinnedTabs(workbenchTabs, pinnedTabIds));
  const hasWorkbenchTabs = $derived(orderedWorkbenchTabs.length > 0);
  const activeWorkbenchTab = $derived(
    orderedWorkbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );
  const activeLogsTab = $derived.by(() => {
    if (!activeWorkbenchTabId?.startsWith("logs:")) return null;
    return logsTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null;
  });
  const activeIncidentTimeline = $derived.by(() => {
    const logs = activeLogsTab?.logsText ?? "";
    if (!logs) return [] as IncidentMarker[];
    return buildIncidentTimeline({ logs, events: [], restartPoints: [] });
  });
  const canShowIncidentTimeline = $derived(activeWorkbenchTab?.kind === "logs");
  const visibleIncidentTimeline = $derived.by(() => {
    if (incidentTimelineDensity === "all") return activeIncidentTimeline;
    return activeIncidentTimeline.filter((marker) => marker.severity === "warning");
  });
  const paneIndexes = $derived(getPaneIndexes());

  function openSheet(item: StatefulSetItem) {
    selectedItem.set(item);
    isSheetOpen.set(true);
    void loadDetailsEvents(item);
  }

  async function loadDetailsEvents(item: StatefulSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!data?.slug || !name) return;
    await detailsActions.runLatest("details", async ({ signal, isLatest }) => {
      detailsLoading = true;
      detailsError = null;
      try {
        const eventsResponse = await kubectlRawArgsFront(
          [
            "get",
            "events",
            "--namespace",
            namespace,
            "--field-selector",
            `involvedObject.kind=StatefulSet,involvedObject.name=${name}`,
            "--sort-by=.lastTimestamp",
            "-o",
            "json",
          ],
          { clusterId: data.slug, signal },
        );
        if (!isLatest()) return;
        if (!eventsResponse.errors && eventsResponse.code === 0 && eventsResponse.output) {
          const parsedEvents = JSON.parse(eventsResponse.output) as {
            items?: Array<{
              type?: string;
              reason?: string;
              message?: string;
              lastTimestamp?: string;
              eventTime?: string;
              firstTimestamp?: string;
            }>;
          };
          detailsEvents = (parsedEvents.items ?? []).map((event) => ({
            type: event.type ?? "-",
            reason: event.reason ?? "-",
            message: event.message ?? "-",
            lastTimestamp: event.lastTimestamp || event.eventTime || event.firstTimestamp || "-",
          }));
        } else {
          detailsEvents = [];
        }
        detailsKeyLoaded = `${namespace}/${name}`;
      } catch (error) {
        if (!isLatest()) return;
        detailsError = error instanceof Error ? error.message : "Failed to load stateful set details.";
        detailsEvents = [];
      } finally {
        if (isLatest()) detailsLoading = false;
      }
    });
  }

  function invalidateStatefulSetsSnapshotCache() {
    invalidateWorkloadSnapshotCache(data?.slug, "statefulsets");
  }

  function getStatefulSetRef(item: StatefulSetItem) {
    const namespace = item.metadata?.namespace ?? "default";
    const name = item.metadata?.name ?? "-";
    return `${namespace}/${name}`;
  }

  function getStatefulSetContainers(item: StatefulSetItem) {
    return item.spec?.template?.spec?.containers?.map((container) => container?.name).filter(Boolean) ?? [];
  }

  function getLogsTab(tabId: string) {
    return logsTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function getYamlTab(tabId: string) {
    return yamlTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function getEventsTab(tabId: string) {
    return eventsTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function getRolloutTab(tabId: string) {
    return rolloutTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updateLogsTab(tabId: string, updater: (tab: LogsTabState) => LogsTabState) {
    logsTabs = logsTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  function updateYamlTab(tabId: string, updater: (tab: YamlTabState) => YamlTabState) {
    yamlTabs = yamlTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  function updateEventsTab(tabId: string, updater: (tab: EventsTabState) => EventsTabState) {
    eventsTabs = eventsTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  function updateRolloutTab(tabId: string, updater: (tab: RolloutTabState) => RolloutTabState) {
    rolloutTabs = rolloutTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  function upsertWorkbenchTab(tab: WorkbenchTab) {
    const existing = workbenchTabs.find((item) => item.id === tab.id);
    if (existing) {
      workbenchTabs = workbenchTabs.map((item) => (item.id === tab.id ? tab : item));
      activeWorkbenchTabId = tab.id;
      return;
    }
    workbenchTabs = [...workbenchTabs, tab];
    activeWorkbenchTabId = tab.id;
  }

  function isTabPinned(tabId: string) {
    return pinnedTabIds.has(tabId);
  }

  function togglePinTab(tabId: string) {
    const next = new Set(pinnedTabIds);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    pinnedTabIds = next;
  }

  function getPaneCount() {
    if (workbenchLayout === "single") return 1;
    if (workbenchLayout === "dual") return 2;
    return 3;
  }

  function getPaneIndexes() {
    return Array.from({ length: getPaneCount() }, (_, idx) => idx as 0 | 1 | 2);
  }

  function getWorkbenchTab(tabId: string | null) {
    if (!tabId) return null;
    return orderedWorkbenchTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function setPaneTabIdsIfChanged(next: [string | null, string | null, string | null]) {
    if (next[0] === paneTabIds[0] && next[1] === paneTabIds[1] && next[2] === paneTabIds[2]) return;
    paneTabIds = next;
  }

  function setCollapsedPaneIndexesIfChanged(next: number[]) {
    if (next.length === collapsedPaneIndexes.length && next.every((value, idx) => value === collapsedPaneIndexes[idx])) return;
    collapsedPaneIndexes = next;
  }

  function setWorkbenchLayout(layout: WorkbenchLayout) {
    workbenchLayout = layout;
    if (layout === "single") {
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      return;
    }
    const ids = orderedWorkbenchTabs.map((tab) => tab.id);
    const used = new Set<string>();
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    for (let idx = 0; idx < 3; idx += 1) {
      if (next[idx] && !ids.includes(next[idx] as string)) next[idx] = null;
      if (next[idx]) used.add(next[idx] as string);
    }
    if (!next[0] && activeWorkbenchTabId) {
      next[0] = activeWorkbenchTabId;
      used.add(activeWorkbenchTabId);
    }
    for (let idx = 1; idx < (layout === "dual" ? 2 : 3); idx += 1) {
      if (next[idx]) continue;
      const candidate = ids.find((id) => !used.has(id)) ?? null;
      next[idx] = candidate;
      if (candidate) used.add(candidate);
    }
    if (layout === "dual") next[2] = null;
    setPaneTabIdsIfChanged(next);
    setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx < getPaneCount()));
  }

  async function requestWorkbenchLayout(nextLayout: WorkbenchLayout) {
    if (nextLayout === workbenchLayout) return;
    const currentPaneCount = getPaneCount();
    const nextPaneCount = nextLayout === "single" ? 1 : nextLayout === "dual" ? 2 : 3;
    if (nextPaneCount >= currentPaneCount) {
      setWorkbenchLayout(nextLayout);
      return;
    }
    const { occupiedRemovedPaneCount, tabsToClose } = computeLayoutClosePlan(paneTabIds, nextPaneCount);
    if (occupiedRemovedPaneCount === 0) {
      setWorkbenchLayout(nextLayout);
      return;
    }
    const confirmed = await confirmWorkbenchLayoutShrink();
    if (!confirmed) return;
    for (const tabId of tabsToClose) await closeWorkbenchTab(tabId, { skipConfirm: true });
    setWorkbenchLayout(nextLayout);
  }

  function setActiveWorkbenchTab(tabId: string) {
    activeWorkbenchTabId = tabId;
    workbenchCollapsed = false;
  }

  function toggleWorkbenchFullscreen() {
    const next = !workbenchFullscreen;
    workbenchFullscreen = next;
    if (next) workbenchCollapsed = false;
  }

  function toggleWorkbenchCollapse() {
    workbenchCollapsed = !workbenchCollapsed;
    if (workbenchCollapsed && workbenchFullscreen) {
      workbenchFullscreen = false;
    }
  }

  function assignTabToPane(paneIndex: 0 | 1 | 2, tabId: string | null) {
    const next: [string | null, string | null, string | null] = [...paneTabIds];
    next[paneIndex] = tabId;
    if (workbenchLayout === "dual") next[2] = null;
    setPaneTabIdsIfChanged(next);
    if (tabId) activeWorkbenchTabId = tabId;
    if (!tabId) {
      setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx !== paneIndex));
    }
  }

  function isPaneCollapsed(paneIndex: number) {
    return collapsedPaneIndexes.includes(paneIndex);
  }

  function canCollapsePane(paneIndex: number) {
    if (getPaneCount() <= 1) return false;
    const tabId = paneTabIds[paneIndex];
    return Boolean(tabId && getWorkbenchTab(tabId));
  }

  function togglePaneCollapsed(paneIndex: number) {
    if (!canCollapsePane(paneIndex)) return;
    if (collapsedPaneIndexes.includes(paneIndex)) {
      setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx !== paneIndex));
      return;
    }
    const paneCount = getPaneCount();
    const expandedCount = paneCount - collapsedPaneIndexes.length;
    if (expandedCount <= 1) return;
    setCollapsedPaneIndexesIfChanged([...collapsedPaneIndexes, paneIndex]);
  }

  function getPaneTab(index: number) {
    return getWorkbenchTab(paneTabIds[index]);
  }

  function getPaneWrapperClass(index: number) {
    return isPaneCollapsed(index) ? "w-11 flex-none" : "min-w-0 flex-1";
  }

  function rememberClosedTab(tabId: string) {
    const tab = orderedWorkbenchTabs.find((item) => item.id === tabId);
    if (!tab) return;
    const logsTab = tab.kind === "logs" ? getLogsTab(tabId) : null;
    const yamlTab = tab.kind === "yaml" ? getYamlTab(tabId) : null;
    const eventsTab = tab.kind === "events" ? getEventsTab(tabId) : null;
    const rolloutTab =
      tab.kind === "rollout-status" || tab.kind === "rollout-history" ? getRolloutTab(tabId) : null;
    const target =
      logsTab?.target ?? yamlTab?.target ?? eventsTab?.target ?? rolloutTab?.target ?? null;
    closedWorkbenchTabs = [
      { kind: tab.kind, target: target ? { ...target } : null, pinned: pinnedTabIds.has(tabId) },
      ...closedWorkbenchTabs.filter(
        (entry) =>
          !(entry.kind === tab.kind && entry.target?.name === target?.name && entry.target?.namespace === target?.namespace),
      ),
    ].slice(0, 30);
  }

  async function closeWorkbenchTab(
    tabId: string,
    options: { skipConfirm?: boolean } = {},
  ) {
    const previousTabs = workbenchTabs;
    const index = previousTabs.findIndex((item) => item.id === tabId);
    if (index === -1) return;
    const closingTab = previousTabs[index];
    if (!options.skipConfirm && (closingTab.kind === "logs" || closingTab.kind === "yaml")) {
      const confirmed = await confirmWorkbenchTabClose(closingTab);
      if (!confirmed) return;
    }
    rememberClosedTab(tabId);
    workbenchTabs = previousTabs.filter((tab) => tab.id !== tabId);
    pinnedTabIds = new Set([...pinnedTabIds].filter((id) => id !== tabId));
    if (tabId.startsWith("logs:")) {
      logsTabs = logsTabs.filter((tab) => tab.id !== tabId);
      stopLiveLogsForTab(tabId);
    } else if (tabId.startsWith("yaml:")) {
      yamlTabs = yamlTabs.filter((tab) => tab.id !== tabId);
    } else if (tabId.startsWith("events:")) {
      eventsTabs = eventsTabs.filter((tab) => tab.id !== tabId);
    } else {
      rolloutTabs = rolloutTabs.filter((tab) => tab.id !== tabId);
    }
    const nextPaneTabIds = paneTabIds.map((id) => (id === tabId ? null : id)) as [string | null, string | null, string | null];
    setPaneTabIdsIfChanged(nextPaneTabIds);
    setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => nextPaneTabIds[idx] !== null));
    if (activeWorkbenchTabId !== tabId) return;
    const remaining = previousTabs.filter((item) => item.id !== tabId);
    if (remaining.length === 0) {
      activeWorkbenchTabId = null;
      workbenchCollapsed = false;
      workbenchFullscreen = false;
      workbenchLayout = "single";
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      // User intentionally closed the last tab; suppress immediate auto-restore from persisted state.
      workbenchRecoveryAttemptedKey = data?.slug ?? null;
      return;
    }
    const nextTab = remaining[index] ?? remaining[index - 1] ?? null;
    activeWorkbenchTabId = nextTab?.id ?? null;
  }

  async function reopenLastClosedTab() {
    const entry = closedWorkbenchTabs[0];
    if (!entry) return;
    closedWorkbenchTabs = closedWorkbenchTabs.slice(1);
    if (!entry.target) return;
    const statefulSet =
      statefulSetsSnapshot.find(
        (item) =>
          item.metadata?.name === entry.target?.name &&
          (item.metadata?.namespace ?? "default") === entry.target?.namespace,
      ) ?? null;
    if (!statefulSet) return;
    if (entry.kind === "logs") {
      await openLogsForStatefulSet(statefulSet);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `logs:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    if (entry.kind === "events") {
      await openEventsForStatefulSet(statefulSet);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `events:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    if (entry.kind === "rollout-status" || entry.kind === "rollout-history") {
      await openRolloutCommandForStatefulSet(entry.kind === "rollout-status" ? "status" : "history", statefulSet);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `${entry.kind}:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    await openYamlForStatefulSet(statefulSet);
    if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `yaml:${entry.target.namespace}/${entry.target.name}`]);
  }

  function canCompareWithSelected(tabId: string) {
    return tabId.startsWith("yaml:");
  }

  function isYamlCompareTarget(tabId: string) {
    return yamlCompareTargetTabId === tabId;
  }

  function selectYamlForCompare(tabId: string) {
    if (!canCompareWithSelected(tabId)) return;
    if (yamlCompareSourceTabId === tabId) {
      yamlCompareSourceTabId = null;
      if (yamlComparePair && (yamlComparePair[0] === tabId || yamlComparePair[1] === tabId)) {
        yamlComparePair = null;
        yamlCompareTargetTabId = null;
      }
      return;
    }
    yamlCompareSourceTabId = tabId;
  }

  function compareYamlWithSelected(targetTabId: string) {
    if (!canCompareWithSelected(targetTabId)) return;
    if (!yamlCompareSourceTabId) {
      yamlCompareSourceTabId = targetTabId;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    if (yamlCompareSourceTabId === targetTabId) {
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    if (
      yamlComparePair &&
      ((yamlComparePair[0] === yamlCompareSourceTabId && yamlComparePair[1] === targetTabId) ||
        (yamlComparePair[1] === yamlCompareSourceTabId && yamlComparePair[0] === targetTabId))
    ) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    yamlComparePair = [yamlCompareSourceTabId, targetTabId];
    yamlCompareTargetTabId = targetTabId;
    setWorkbenchLayout("dual");
    assignTabToPane(0, yamlCompareSourceTabId);
    assignTabToPane(1, targetTabId);
    assignTabToPane(2, null);
    setActiveWorkbenchTab(targetTabId);
  }

  function getYamlCompareDiffLines(tabId: string) {
    if (!yamlComparePair) return [];
    const [leftId, rightId] = yamlComparePair;
    const partnerId = leftId === tabId ? rightId : rightId === tabId ? leftId : null;
    if (!partnerId) return [];
    const tab = getYamlTab(tabId);
    const partner = getYamlTab(partnerId);
    if (!tab || !partner) return [];
    const leftLines = tab.yamlText.replace(/\r\n/g, "\n").split("\n");
    const rightLines = partner.yamlText.replace(/\r\n/g, "\n").split("\n");
    const maxLines = Math.max(leftLines.length, rightLines.length);
    const diffLines: number[] = [];
    for (let idx = 0; idx < maxLines; idx += 1) {
      if ((leftLines[idx] ?? "") !== (rightLines[idx] ?? "")) {
        diffLines.push(idx + 1);
      }
    }
    return diffLines;
  }

  function jumpToIncidentMarker(marker: IncidentMarker) {
    incidentTimelineCursorId = marker.id;
    logsJumpToLine = marker.line ?? null;
  }

  function trimLogs(raw: string) {
    if (raw.length <= logsMaxChars) return raw;
    return raw.slice(raw.length - logsMaxChars);
  }

  function clearStreamReconnect(tabId: string) {
    const timer = logsStreamReconnectTimers.get(tabId);
    if (!timer) return;
    clearTimeout(timer);
    logsStreamReconnectTimers.delete(tabId);
  }

  function bumpStreamToken(tabId: string) {
    const next = (logsStreamTokens.get(tabId) ?? 0) + 1;
    logsStreamTokens.set(tabId, next);
    return next;
  }

  async function stopStreamForTab(tabId: string, invalidate = true) {
    if (invalidate) bumpStreamToken(tabId);
    clearStreamReconnect(tabId);
    const process = logsStreamProcesses.get(tabId);
    logsStreamProcesses.delete(tabId);
    if (!process) return;
    await process.stop();
  }

  function stopLiveLogsForTab(tabId: string) {
    const timer = logsLiveTimers.get(tabId);
    if (timer) clearInterval(timer);
    logsLiveTimers.delete(tabId);
    void stopStreamForTab(tabId);
  }

  function shouldKeepStreaming(tabId: string) {
    const tab = getLogsTab(tabId);
    return Boolean(tab && tab.logsLive && tab.logsMode === "stream-f");
  }

  function scheduleStreamReconnect(tabId: string) {
    clearStreamReconnect(tabId);
    if (!shouldKeepStreaming(tabId)) return;
    updateLogsTab(tabId, (current) => ({ ...current, logsLoading: true, logsError: "Stream disconnected. Reconnecting..." }));
    const timer = setTimeout(() => {
      logsStreamReconnectTimers.delete(tabId);
      if (!shouldKeepStreaming(tabId)) return;
      void startFollowStreamForTab(tabId);
    }, logsStreamReconnectMs);
    logsStreamReconnectTimers.set(tabId, timer);
  }

  async function startFollowStreamForTab(tabId: string) {
    if (!data?.slug) return;
    const tab = getLogsTab(tabId);
    if (!tab || !tab.logsLive || tab.logsMode !== "stream-f") return;
    const token = bumpStreamToken(tabId);
    await stopStreamForTab(tabId, false);
    updateLogsTab(tabId, (current) => ({ ...current, logsLoading: true, logsError: null }));
    const args = [
      "logs",
      `statefulset/${tab.target.name}`,
      "--namespace",
      tab.target.namespace,
      "--all-pods=true",
      "--all-containers=true",
      "--prefix=true",
      "--timestamps=true",
      "--tail=600",
      "-f",
    ];
    if (tab.logsPrevious) args.push("--previous");
    if (tab.logsSelectedContainer !== "all-containers") args.push("-c", tab.logsSelectedContainer);
    try {
      const process = await openStreamWithOptionalFallback(() =>
        kubectlStreamArgsFront(args, { clusterId: data.slug }, {
          onStdoutData: (chunk) => {
            if (logsStreamTokens.get(tabId) !== token || !chunk) return;
            updateLogsTab(tabId, (current) => ({
              ...current,
              logsLoading: false,
              logsError: null,
              logsText: trimLogs(`${current.logsText}${chunk}`),
              logsUpdatedAt: Date.now(),
            }));
          },
          onStderrData: (chunk) => {
            if (logsStreamTokens.get(tabId) !== token) return;
            const message = chunk.trim();
            if (!message) return;
            updateLogsTab(tabId, (current) => ({ ...current, logsLoading: false, logsError: message }));
          },
          onClose: () => {
            if (logsStreamTokens.get(tabId) !== token) return;
            logsStreamProcesses.delete(tabId);
            if (!shouldKeepStreaming(tabId)) return;
            scheduleStreamReconnect(tabId);
          },
          onError: (error) => {
            if (logsStreamTokens.get(tabId) !== token) return;
            updateLogsTab(tabId, (current) => ({
              ...current,
              logsLoading: false,
              logsError: error instanceof Error ? error.message : String(error),
            }));
            scheduleStreamReconnect(tabId);
          },
        }),
      );
      if (logsStreamTokens.get(tabId) !== token) {
        await process.stop();
        return;
      }
      logsStreamProcesses.set(tabId, process);
      updateLogsTab(tabId, (current) => ({ ...current, logsLoading: false }));
    } catch (error) {
      updateLogsTab(tabId, (current) => ({
        ...current,
        logsLoading: false,
        logsError: error instanceof Error ? error.message : "Failed to start log stream.",
      }));
      scheduleStreamReconnect(tabId);
    }
  }

  async function loadLogsForTab(tabId: string) {
    if (!data?.slug) return;
    const tab = getLogsTab(tabId);
    if (!tab) return;
    await detailsActions.runLatest(`logs:${tabId}`, async ({ signal, isLatest }) => {
      updateLogsTab(tabId, (current) => ({ ...current, logsLoading: true, logsError: null }));
      const args = [
        "logs",
        `statefulset/${tab.target.name}`,
        "--namespace",
        tab.target.namespace,
        "--all-pods=true",
        "--all-containers=true",
        "--prefix=true",
        "--timestamps=true",
        "--tail=600",
      ];
      if (tab.logsPrevious) args.push("--previous");
      if (tab.logsSelectedContainer !== "all-containers") args.push("-c", tab.logsSelectedContainer);
      try {
        const response = await kubectlRawArgsFront(args, { clusterId: data.slug, signal });
        if (!isLatest()) return;
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || "Failed to load stateful set logs.");
        }
        updateLogsTab(tabId, (current) => ({
          ...current,
          logsLoading: false,
          logsError: null,
          logsText: response.output || "",
          logsUpdatedAt: Date.now(),
        }));
      } catch (error) {
        if (!isLatest()) return;
        updateLogsTab(tabId, (current) => ({
          ...current,
          logsLoading: false,
          logsError: error instanceof Error ? error.message : "Failed to load stateful set logs.",
        }));
      }
    });
  }

  function startLiveLogsForTab(tabId: string) {
    stopLiveLogsForTab(tabId);
    const tab = getLogsTab(tabId);
    if (!tab?.logsLive) return;
    if (tab.logsMode === "stream-f") {
      void startFollowStreamForTab(tabId);
      return;
    }
    void loadLogsForTab(tabId);
    const timer = setInterval(() => {
      void loadLogsForTab(tabId);
    }, logsLivePollMs);
    logsLiveTimers.set(tabId, timer);
  }

  async function refreshYamlForTab(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!tab || !data?.slug) return;
    await detailsActions.runLatest(`yaml:${tabId}`, async ({ signal, isLatest }) => {
      updateYamlTab(tabId, (current) => ({ ...current, yamlLoading: true, yamlError: null }));
      try {
        const response = await kubectlRawArgsFront(
          ["get", "statefulset", tab.target.name, "--namespace", tab.target.namespace, "-o", "yaml"],
          { clusterId: data.slug, signal },
        );
        if (!isLatest()) return;
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || "Failed to load stateful set YAML.");
        }
        updateYamlTab(tabId, (current) => ({
          ...current,
          yamlLoading: false,
          yamlError: null,
          yamlText: response.output || "",
          yamlOriginalText: response.output || "",
        }));
      } catch (error) {
        if (!isLatest()) return;
        updateYamlTab(tabId, (current) => ({
          ...current,
          yamlLoading: false,
          yamlError: error instanceof Error ? error.message : "Failed to load stateful set YAML.",
        }));
      }
    });
  }

  async function openLogsForStatefulSet(item: StatefulSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const tabId = `logs:${namespace}/${name}`;
    const existing = getLogsTab(tabId);
    const containers = getStatefulSetContainers(item);
    if (!existing) {
      logsTabs = [
        ...logsTabs,
        {
          id: tabId,
          target: { name, namespace },
          logsText: "",
          logsError: null,
          logsLoading: false,
          logsLive: true,
          logsMode: "poll",
          logsUpdatedAt: null,
          logsPrevious: false,
          logsContainerOptions: ["all-containers", ...containers],
          logsSelectedContainer: "all-containers",
          bookmarks: [],
        },
      ];
    } else {
      updateLogsTab(tabId, (current) => ({
        ...current,
        target: { name, namespace },
        logsContainerOptions: ["all-containers", ...containers],
      }));
    }
    upsertWorkbenchTab({ id: tabId, kind: "logs", title: `Logs ${name}`, subtitle: namespace });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    await loadLogsForTab(tabId);
    startLiveLogsForTab(tabId);
  }

  async function openYamlForStatefulSet(item: StatefulSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const tabId = `yaml:${namespace}/${name}`;
    const existing = getYamlTab(tabId);
    if (!existing) {
      yamlTabs = [
        ...yamlTabs,
        {
          id: tabId,
          target: { name, namespace },
          yamlLoading: true,
          yamlSaving: false,
          yamlError: null,
          yamlText: "",
          yamlOriginalText: "",
        },
      ];
    } else {
      updateYamlTab(tabId, (current) => ({ ...current, target: { name, namespace }, yamlLoading: true, yamlError: null }));
    }
    upsertWorkbenchTab({ id: tabId, kind: "yaml", title: `YAML ${name}`, subtitle: namespace });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    await refreshYamlForTab(tabId);
  }

  async function openEventsForStatefulSet(item: StatefulSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name || !data?.slug) return;
    const tabId = `events:${namespace}/${name}`;
    const existing = getEventsTab(tabId);
    if (!existing) {
      eventsTabs = [
        ...eventsTabs,
        {
          id: tabId,
          target: { name, namespace },
          events: [],
          eventsLoading: true,
          eventsError: null,
        },
      ];
    } else {
      updateEventsTab(tabId, (current) => ({
        ...current,
        target: { name, namespace },
        eventsLoading: true,
        eventsError: null,
      }));
    }
    upsertWorkbenchTab({ id: tabId, kind: "events", title: `Events ${name}`, subtitle: namespace });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    try {
      const events = await loadWorkloadEvents(data.slug, {
        resource: "statefulset",
        name,
        namespace,
      });
      updateEventsTab(tabId, (current) => ({
        ...current,
        events,
        eventsLoading: false,
        eventsError: null,
      }));
    } catch (error) {
      updateEventsTab(tabId, (current) => ({
        ...current,
        events: [],
        eventsLoading: false,
        eventsError: error instanceof Error ? error.message : "Failed to load stateful set events.",
      }));
    }
  }

  async function openRolloutCommandForStatefulSet(mode: RolloutCommandMode, item: StatefulSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name || !data?.slug) return;
    const tabKind = mode === "status" ? "rollout-status" : "rollout-history";
    const tabId = `${tabKind}:${namespace}/${name}`;
    const existing = getRolloutTab(tabId);
    if (!existing) {
      rolloutTabs = [
        ...rolloutTabs,
        {
          id: tabId,
          target: { name, namespace },
          mode,
          output: "",
          loading: true,
          error: null,
        },
      ];
    } else {
      updateRolloutTab(tabId, (current) => ({
        ...current,
        target: { name, namespace },
        mode,
        loading: true,
        error: null,
      }));
    }
    upsertWorkbenchTab({
      id: tabId,
      kind: tabKind,
      title: `${mode === "status" ? "Rollout status" : "Rollout history"} ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    try {
      const output = await loadRolloutCommandOutput(data.slug, mode, {
        resource: "statefulset",
        name,
        namespace,
      });
      updateRolloutTab(tabId, (current) => ({
        ...current,
        output,
        loading: false,
        error: null,
      }));
    } catch (error) {
      updateRolloutTab(tabId, (current) => ({
        ...current,
        output: "",
        loading: false,
        error: error instanceof Error ? error.message : `Failed to load rollout ${mode}.`,
      }));
    }
  }

  async function openStatefulSetInvestigationWorkspace(item: StatefulSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const logsTabId = `logs:${namespace}/${name}`;
    const yamlTabId = `yaml:${namespace}/${name}`;
    await openLogsForStatefulSet(item);
    await openYamlForStatefulSet(item);
    setWorkbenchLayout("dual");
    assignTabToPane(0, logsTabId);
    assignTabToPane(1, yamlTabId);
    assignTabToPane(2, null);
    activeWorkbenchTabId = logsTabId;
  }

  function stopAllLiveLogs() {
    for (const timer of logsLiveTimers.values()) clearInterval(timer);
    logsLiveTimers.clear();
    for (const timer of logsStreamReconnectTimers.values()) clearTimeout(timer);
    logsStreamReconnectTimers.clear();
    for (const process of logsStreamProcesses.values()) void process.stop();
    logsStreamProcesses.clear();
    logsStreamTokens.clear();
  }

  function clearActionFeedback() {
    actionNotification = null;
    yamlDownloadError = null;
    yamlDownloadMessage = null;
  }

  async function copyTextToClipboard(text: string) {
    if (typeof window === "undefined") return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  async function copyDescribeCommandForStatefulSet(item: StatefulSetItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    const command = buildKubectlDescribeCommand({
      resource: "statefulsets",
      name,
      namespace,
    });
    try {
      await copyTextToClipboard(command);
      actionNotification = notifySuccess(`Copied describe command for ${namespace}/${name}.`);
      actionNotification = null;
    } catch {
      actionNotification = notifyError("Failed to copy kubectl describe command.");
    }
  }

  function openDebugDescribeForStatefulSet(item: StatefulSetItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    runDebugDescribe({
      clusterId: data.slug,
      resource: "statefulset",
      name,
      namespace,
      title: `Describe statefulset ${namespace}/${name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${namespace}/${name}.`);
    actionNotification = null;
  }

  async function downloadYamlForStatefulSets(items: StatefulSetItem[]) {
    if (!data?.slug || items.length === 0) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["get", "statefulset", name, "--namespace", namespace, "-o", "yaml"],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to download YAML for ${namespace}/${name}.`);
        }
        const filename = buildYamlFilename("statefulset", namespace, name);
        await writeTextFile(filename, response.output || "", { baseDir: BaseDirectory.Download });
      }
      if (items.length === 1) {
        const only = items[0];
        const onlyName = only.metadata?.name ?? "statefulset";
        const onlyNs = only.metadata?.namespace ?? "default";
        yamlDownloadMessage = `StatefulSet YAML exported: ${onlyNs}/${onlyName} -> ~/Downloads/${buildYamlFilename("statefulset", onlyNs, onlyName)}`;
      } else {
        yamlDownloadMessage = `StatefulSet YAML export completed: ${items.length} files in ~/Downloads.`;
      }
    } catch (error) {
      yamlDownloadError = error instanceof Error ? error.message : "Failed to download YAML.";
    } finally {
      actionInFlight = false;
    }
  }

  async function restartStatefulSets(items: StatefulSetItem[]) {
    if (!data?.slug || items.length === 0) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["rollout", "restart", `statefulset/${name}`, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to restart ${namespace}/${name}.`);
        }
      }
      if (items.length === 1) {
        actionNotification = notifySuccess(`Rollout restart executed for StatefulSet ${getStatefulSetRef(items[0])}.`);
      } else {
        actionNotification = notifySuccess(`Rollout restart executed for ${items.length} StatefulSets.`);
      }
      invalidateStatefulSetsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to restart stateful sets.");
    } finally {
      actionInFlight = false;
    }
  }

  async function scaleStatefulSets(items: StatefulSetItem[], replicas?: number) {
    if (!data?.slug || items.length === 0) return;
    let desiredReplicas = replicas;
    if (desiredReplicas === undefined) {
      if (items.length !== 1) return;
      const current = typeof items[0].spec?.replicas === "number" ? items[0].spec?.replicas : 1;
      const requested = requestReplicaCount(current);
      if (requested === null) return;
      desiredReplicas = requested;
    }

    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["scale", "statefulset", name, "--namespace", namespace, `--replicas=${desiredReplicas}`],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to scale ${namespace}/${name}.`);
        }
      }
      if (items.length === 1) {
        actionNotification = notifySuccess(`Scaled StatefulSet ${getStatefulSetRef(items[0])} to ${desiredReplicas}.`);
      } else {
        actionNotification = notifySuccess(`Scaled ${items.length} StatefulSets to ${desiredReplicas}.`);
      }
      updateStatefulSetsReplicas(items, desiredReplicas);
      invalidateStatefulSetsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to scale stateful sets.");
    } finally {
      actionInFlight = false;
    }
  }

  function requestReplicaCount(currentReplicas: number) {
    if (typeof window === "undefined") return null;
    const raw = window.prompt("Enter desired replica count (0 or greater):", String(currentReplicas));
    if (raw === null) return null;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      actionNotification = notifyError("Replica count must be a non-negative integer.");
      return null;
    }
    return Number.parseInt(trimmed, 10);
  }

  async function deleteStatefulSets(items: StatefulSetItem[]) {
    if (!data?.slug || items.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${items.length} stateful set${items.length === 1 ? "" : "s"}? This cannot be undone.`,
      "Confirm delete",
    );
    if (!confirmed) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["delete", "statefulset", name, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to delete ${namespace}/${name}.`);
        }
      }
      selectedStatefulSetIds = new Set<string>();
      if (items.length === 1) {
        actionNotification = notifySuccess(`Deleted StatefulSet ${getStatefulSetRef(items[0])}.`);
      } else {
        actionNotification = notifySuccess(`Deleted ${items.length} StatefulSets.`);
      }
      removeStatefulSetsFromSnapshot(items);
      invalidateStatefulSetsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["DELETED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to delete stateful sets.");
    } finally {
      actionInFlight = false;
    }
  }

  function isStatefulSetSelected(id: string) {
    return selectedStatefulSetIds.has(id);
  }

  function toggleStatefulSetSelection(id: string, next?: boolean) {
    if (!id) return;
    const shouldSelect = typeof next === "boolean" ? next : !selectedStatefulSetIds.has(id);
    const updated = new Set(selectedStatefulSetIds);
    if (shouldSelect) updated.add(id);
    else updated.delete(id);
    selectedStatefulSetIds = updated;
  }

  function toggleAllSelection(next?: boolean) {
    if (availableIds.length === 0) {
      selectedStatefulSetIds = new Set<string>();
      return;
    }
    const shouldSelectAll =
      typeof next === "boolean" ? next : availableIds.some((id) => !selectedStatefulSetIds.has(id));
    selectedStatefulSetIds = shouldSelectAll ? new Set(availableIds) : new Set<string>();
  }

  function toggleGroupSelection(_groupKey: string, next: boolean, rowIds: string[]) {
    const updated = new Set(selectedStatefulSetIds);
    if (next) rowIds.forEach((id) => updated.add(id));
    else rowIds.forEach((id) => updated.delete(id));
    selectedStatefulSetIds = updated;
  }

  function clampWatcherRefreshSeconds(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    return Math.min(600, Math.max(5, Math.round(value)));
  }

  function getWatcherSettingsKey(clusterId: string) {
    return `${WATCHER_SETTINGS_PREFIX}:${clusterId}`;
  }

  function loadWatcherSettings(clusterId: string): WatcherSettings {
    if (typeof window === "undefined") return DEFAULT_WATCHER_SETTINGS;
    try {
      const raw = window.localStorage.getItem(getWatcherSettingsKey(clusterId));
      if (!raw) return DEFAULT_WATCHER_SETTINGS;
      const parsed = JSON.parse(raw) as Partial<WatcherSettings>;
      return {
        enabled:
          typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_WATCHER_SETTINGS.enabled,
        refreshSeconds: clampWatcherRefreshSeconds(
          parsed.refreshSeconds ?? DEFAULT_WATCHER_SETTINGS.refreshSeconds,
        ),
        viewMode:
          parsed.viewMode === "namespace" || parsed.viewMode === "flat"
            ? parsed.viewMode
            : "flat",
      };
    } catch {
      return DEFAULT_WATCHER_SETTINGS;
    }
  }

  function persistWatcherSettings() {
    if (typeof window === "undefined") return;
    if (!data?.slug) return;
    const payload: WatcherSettings = {
      enabled: watcherEnabled,
      refreshSeconds: clampWatcherRefreshSeconds(watcherRefreshSeconds),
      viewMode: statefulSetsTableViewMode,
    };
    try {
      window.localStorage.setItem(getWatcherSettingsKey(data.slug), JSON.stringify(payload));
    } catch {
      // Ignore localStorage failures.
    }
  }

  function stopWatcherTimer() {
    watcherEngine.stop();
  }

  function startWatcherTimer() {
    watcherEngine.start();
  }

  function bindStatefulSetsSyncStore(clusterId: string) {
    statefulSetsSyncStoreUnsubscribe?.();
    statefulSetsSyncStoreUnsubscribe = selectClusterStatefulSets(clusterId).subscribe((items) => {
      statefulSetsSnapshot = items as StatefulSetItem[];
      lastWatcherSuccessAt = Date.now();
    });
  }

  async function refreshStatefulSetsFromWatcher(source: "manual" | "watcher" = "watcher") {
    if (!data?.slug) return;
    if (source === "watcher" && !watcherPolicy.enabled) return;
    if (source === "watcher" && watcherPolicy.mode === "stream") return;
    if (watcherInFlight) return;
    if (
      source === "watcher" &&
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }

    watcherInFlight = true;
    watcherError = null;
    markStatefulSetsSyncLoading(data.slug);
    try {
      statefulSetsSnapshot = await fetchNamespacedSnapshotItems<StatefulSetItem>({
        clusterId: data.slug,
        selectedNamespace: $selectedNamespace,
        resource: "statefulsets",
        errorMessage: "StatefulSets watcher sync failed.",
      });
      lastWatcherSuccessAt = Date.now();
      markStatefulSetsSyncSuccess(data.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : "StatefulSets watcher sync failed.";
      watcherError = message;
      markStatefulSetsSyncError(data.slug, message);
    } finally {
      watcherInFlight = false;
    }
  }

  function applyWatcherMode() {
    if (!data?.slug) return;
    if (watcherPolicy.enabled) {
      setStatefulSetsSyncEnabled(data.slug, true);
      if (watcherPolicy.mode === "stream") {
        stopWatcherTimer();
        bindStatefulSetsSyncStore(data.slug);
        initStatefulSetsSync(data.slug, Array.isArray(data.statefulsets) ? data.statefulsets : []);
        statefulSetsSyncStarted = true;
      } else {
        if (statefulSetsSyncStarted) {
          destroyStatefulSetsSync(data.slug);
          statefulSetsSyncStarted = false;
        }
        startWatcherTimer();
      }
      void refreshStatefulSetsFromWatcher();
      return;
    }
    setStatefulSetsSyncEnabled(data.slug, false);
    stopWatcherTimer();
    if (statefulSetsSyncStarted) {
      destroyStatefulSetsSync(data.slug);
      statefulSetsSyncStarted = false;
    }
  }

  function removeStatefulSetsFromSnapshot(items: StatefulSetItem[]) {
    const keys = new Set(
      items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
    );
    if (watcherPolicy.mode === "stream" && data?.slug) {
      for (const item of items) {
        applyStatefulSetEvent(data.slug, { type: "DELETED", object: item });
      }
      return;
    }
    statefulSetsSnapshot = statefulSetsSnapshot.filter((item) => {
      const key = `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`;
      return !keys.has(key);
    });
  }

  function updateStatefulSetsReplicas(items: StatefulSetItem[], replicas: number) {
    const keys = new Set(
      items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
    );
    if (watcherPolicy.mode === "stream" && data?.slug) {
      for (const item of items) {
        applyStatefulSetEvent(data.slug, {
          type: "MODIFIED",
          object: {
            ...item,
            spec: {
              ...(item.spec ?? {}),
              replicas,
            },
          },
        });
      }
      return;
    }
    statefulSetsSnapshot = statefulSetsSnapshot.map((item) => {
      const key = `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`;
      if (!keys.has(key)) return item;
      return {
        ...item,
        spec: {
          ...(item.spec ?? {}),
          replicas,
        },
      };
    });
  }

  function toggleWatcher() {
    watcherEnabled = !watcherEnabled;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function setWatcherRefreshSeconds(value: number) {
    watcherRefreshSeconds = clampWatcherRefreshSeconds(value);
    persistWatcherSettings();
    if (watcherPolicy.enabled) {
      applyWatcherMode();
    }
  }

  function setViewMode(mode: StatefulSetsTableViewMode) {
    statefulSetsTableViewMode = mode;
    persistWatcherSettings();
  }

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    statefulSetsTableViewMode = DEFAULT_WATCHER_SETTINGS.viewMode;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function parseWorkbenchTabId(
    tabId: string,
  ): {
    kind: "logs" | "yaml" | "events" | "rollout-status" | "rollout-history";
    name: string;
    namespace: string;
  } | null {
    const match = /^(logs|yaml|events|rollout-status|rollout-history):([^/]+)\/(.+)$/.exec(tabId);
    if (!match) return null;
    return {
      kind: match[1] as "logs" | "yaml" | "events" | "rollout-status" | "rollout-history",
      namespace: match[2],
      name: match[3],
    };
  }

  function clearWorkbenchState(clusterId: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(getStatefulSetsWorkbenchStateKey(clusterId));
    } catch {
      // Ignore localStorage failures.
    }
  }

  function persistWorkbenchState() {
    if (typeof window === "undefined" || !data?.slug) return;
    if (workbenchTabs.length === 0) {
      clearWorkbenchState(data.slug);
      return;
    }
    const tabs = orderedWorkbenchTabs
      .map((tab) => {
        const parsed = parseWorkbenchTabId(tab.id);
        if (!parsed) return null;
        return {
          kind: parsed.kind,
          name: parsed.name,
          namespace: parsed.namespace,
          pinned: pinnedTabIds.has(tab.id),
        };
      })
      .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
    const payload: PersistedStatefulSetsWorkbenchState = {
      version: 1,
      tabs,
      activeTabId: activeWorkbenchTabId,
      layout: workbenchLayout,
      paneTabIds,
      collapsedPaneIndexes,
      closedTabs: closedWorkbenchTabs,
      workbenchCollapsed,
      workbenchFullscreen,
    };
    try {
      window.localStorage.setItem(
        getStatefulSetsWorkbenchStateKey(data.slug),
        JSON.stringify(payload),
      );
    } catch {
      // Ignore localStorage failures.
    }
  }

  function loadWorkbenchState(clusterId: string) {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(getStatefulSetsWorkbenchStateKey(clusterId));
      return parseStatefulSetsWorkbenchState(raw);
    } catch {
      return null;
    }
  }

  function tryRestorePendingWorkbenchState() {
    if (workbenchStateRestored) return;
    if (pendingWorkbenchState === undefined) return;
    if (!pendingWorkbenchState) {
      workbenchStateRestored = true;
      workbenchRecoveryAttemptedKey = data?.slug ?? null;
      return;
    }
    const state = pendingWorkbenchState;
    const entries = state.tabs
      .map((tab) => {
        const item =
          statefulSetsSnapshot.find(
            (entry) =>
              entry.metadata?.name === tab.name &&
              (entry.metadata?.namespace ?? "default") === tab.namespace,
          ) ?? null;
        return item ? { tab, item } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (state.tabs.length > 0 && entries.length === 0 && statefulSetsSnapshot.length === 0) {
      return;
    }
    for (const entry of entries) {
      if (entry.tab.kind === "logs") {
        void openLogsForStatefulSet(entry.item);
      } else if (entry.tab.kind === "yaml") {
        void openYamlForStatefulSet(entry.item);
      } else if (entry.tab.kind === "events") {
        void openEventsForStatefulSet(entry.item);
      } else {
        void openRolloutCommandForStatefulSet(
          entry.tab.kind === "rollout-status" ? "status" : "history",
          entry.item,
        );
      }
    }
    const restoredPinnedIds = state.tabs
      .filter((tab) => tab.pinned)
      .map((tab) => `${tab.kind}:${tab.namespace}/${tab.name}`);
    if (restoredPinnedIds.length > 0) {
      pinnedTabIds = new Set([...pinnedTabIds, ...restoredPinnedIds]);
    }
    closedWorkbenchTabs = state.closedTabs;
    workbenchLayout = state.layout;
    paneTabIds = state.paneTabIds;
    collapsedPaneIndexes = state.collapsedPaneIndexes;
    workbenchCollapsed = state.workbenchCollapsed;
    workbenchFullscreen = state.workbenchFullscreen;
    pendingWorkbenchState = null;
    workbenchStateRestored = true;
    workbenchRecoveryAttemptedKey = data?.slug ?? null;
  }

  $effect(() => {
    if (!data?.slug) return;
    setInitialStatefulSets(data.slug, data.statefulsets ?? []);
    if (watcherPolicy.mode !== "stream") {
      statefulSetsSnapshot = data.statefulsets ?? [];
    }
  });

  $effect(() => {
    const nextSelection = pruneSelectedStatefulSetIds(selectedStatefulSetIds, availableIds);
    if (nextSelection !== selectedStatefulSetIds) {
      selectedStatefulSetIds = nextSelection;
    }
  });

  $effect(() => {
    statefulSetsSnapshot;
    tryRestorePendingWorkbenchState();
  });

  $effect(() => {
    if (!data?.slug) return;
    if (!workbenchStateRestored) return;
    if (workbenchTabs.length > 0) return;
    if (logsTabs.length > 0 || yamlTabs.length > 0 || eventsTabs.length > 0 || rolloutTabs.length > 0) return;
    if (workbenchRecoveryAttemptedKey === data.slug) return;
    const restoredState = loadWorkbenchState(data.slug);
    if (!restoredState || restoredState.tabs.length === 0) {
      workbenchRecoveryAttemptedKey = data.slug;
      return;
    }
    workbenchRecoveryAttemptedKey = data.slug;
    pendingWorkbenchState = restoredState;
    workbenchStateRestored = false;
  });

  $effect(() => {
    const ids = orderedWorkbenchTabs.map((tab) => tab.id);
    if (ids.length === 0) {
      if (activeWorkbenchTabId !== null) activeWorkbenchTabId = null;
      if (workbenchLayout !== "single") workbenchLayout = "single";
      if (paneTabIds[0] !== null || paneTabIds[1] !== null || paneTabIds[2] !== null) {
        paneTabIds = [null, null, null];
      }
      if (collapsedPaneIndexes.length > 0) collapsedPaneIndexes = [];
      if (pinnedTabIds.size > 0) pinnedTabIds = new Set<string>();
      if (closedWorkbenchTabs.length > 0) closedWorkbenchTabs = [];
      if (yamlCompareSourceTabId !== null) yamlCompareSourceTabId = null;
      if (yamlComparePair !== null) yamlComparePair = null;
      if (yamlCompareTargetTabId !== null) yamlCompareTargetTabId = null;
      return;
    }
    const hasActive = orderedWorkbenchTabs.some((tab) => tab.id === activeWorkbenchTabId);
    if (!hasActive) activeWorkbenchTabId = orderedWorkbenchTabs[0]?.id ?? null;
    if (workbenchLayout !== "single") {
      const paneCount = getPaneCount();
      const nextPaneTabIds: [string | null, string | null, string | null] = [...paneTabIds];
      for (let idx = 0; idx < paneCount; idx += 1) {
        if (nextPaneTabIds[idx] && !ids.includes(nextPaneTabIds[idx] as string)) nextPaneTabIds[idx] = null;
      }
      if (!nextPaneTabIds[0] && activeWorkbenchTabId) nextPaneTabIds[0] = activeWorkbenchTabId;
      if (paneCount === 2) nextPaneTabIds[2] = null;
      setPaneTabIdsIfChanged(nextPaneTabIds);
      setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx < paneCount));
    }
    if (!yamlComparePair) return;
    const [leftId, rightId] = yamlComparePair;
    if (!ids.includes(leftId) || !ids.includes(rightId)) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
  });

  $effect(() => {
    if ($dashboardDataProfile.id !== "realtime") return;
    if (workbenchCollapsed) workbenchCollapsed = false;
    if (collapsedPaneIndexes.length > 0) collapsedPaneIndexes = [];
  });

  $effect(() => {
    if (!workbenchStateRestored) return;
    workbenchTabs;
    activeWorkbenchTabId;
    workbenchLayout;
    paneTabIds;
    collapsedPaneIndexes;
    workbenchCollapsed;
    workbenchFullscreen;
    pinnedTabIds;
    closedWorkbenchTabs;
    persistWorkbenchState();
  });

  $effect(() => {
    const clusterId = data?.slug ?? null;
    if (!clusterId) return;
    if (watcherSettingsLoadedCluster === clusterId) return;

    const previousClusterId = watcherSettingsLoadedCluster;
    if (previousClusterId) {
      setStatefulSetsSyncEnabled(previousClusterId, false);
      resetStatefulSetsSyncStatus(previousClusterId);
      if (statefulSetsSyncStarted) {
        destroyStatefulSetsSync(previousClusterId);
        statefulSetsSyncStarted = false;
      }
      statefulSetsSyncStoreUnsubscribe?.();
      statefulSetsSyncStoreUnsubscribe = null;
    }

    const settings = loadWatcherSettings(clusterId);
    watcherEnabled = settings.enabled;
    watcherRefreshSeconds = settings.refreshSeconds;
    statefulSetsTableViewMode = settings.viewMode;
    watcherSettingsLoadedCluster = clusterId;
    applyWatcherMode();
  });

  onMount(() => {
    const runtimeClockTimer = setInterval(() => {
      runtimeClockNow = Date.now();
    }, 5_000);
    if (data?.slug) {
      pendingWorkbenchState = loadWorkbenchState(data.slug);
      tryRestorePendingWorkbenchState();
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (watcherPolicy.enabled) {
          applyWatcherMode();
        }
        return;
      }
      stopWatcherTimer();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(runtimeClockTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  onDestroy(() => {
    detailsActions.abortAll();
    persistWorkbenchState();
    stopWatcherTimer();
    mutationReconcile.clearScope();
    statefulSetsSyncStoreUnsubscribe?.();
    statefulSetsSyncStoreUnsubscribe = null;
    stopAllLiveLogs();
    if (!data?.slug) return;
    destroyStatefulSetsSync(data.slug);
    resetStatefulSetsSyncStatus(data.slug);
  });
</script>

<div class="grid w-full grid-cols-1 overflow-visible">
  <ActionNotificationBar notification={actionNotification} onDismiss={() => { actionNotification = null; }} />
  {#if yamlDownloadError}
    <Alert.Root variant="destructive" class="mb-4">
      <button
        type="button"
        class="absolute right-2 top-2 rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30"
        aria-label="Close notification"
        title="Close"
        onclick={() => {
          yamlDownloadError = null;
        }}
      >
        <X class="h-3.5 w-3.5" />
      </button>
      <Alert.Description>{yamlDownloadError}</Alert.Description>
    </Alert.Root>
  {/if}
  {#if yamlDownloadMessage}
    <Alert.Root class="mb-4 border-emerald-400/40 bg-emerald-100/20 text-emerald-900 dark:text-emerald-200">
      <button
        type="button"
        class="absolute right-2 top-2 rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30"
        aria-label="Close notification"
        title="Close"
        onclick={() => {
          yamlDownloadMessage = null;
        }}
      >
        <X class="h-3.5 w-3.5" />
      </button>
      <Alert.Description>{yamlDownloadMessage}</Alert.Description>
    </Alert.Root>
  {/if}
  {#if hasWorkbenchTabs}
    <div
      class={`overflow-hidden bg-card pointer-events-auto ${
        workbenchFullscreen
          ? "fixed inset-0 z-[120] mb-0 flex h-[100dvh] w-[100vw] flex-col rounded-none border-0 shadow-none"
          : "relative z-[100] mb-4 rounded-lg border shadow-sm"
      }`}
    >
      <MultiPaneWorkbench
        tabs={orderedWorkbenchTabs}
        activeTabId={activeWorkbenchTabId}
        {isTabPinned}
        onActivateTab={setActiveWorkbenchTab}
        onTogglePin={togglePinTab}
        onCloseTab={(tabId) => {
          void closeWorkbenchTab(tabId, { skipConfirm: true });
        }}
        onReopenLastClosedTab={() => {
          void reopenLastClosedTab();
        }}
        reopenDisabled={closedWorkbenchTabs.length === 0}
        layout={workbenchLayout}
        onLayoutChange={(nextLayout) => {
          void requestWorkbenchLayout(nextLayout as WorkbenchLayout);
        }}
        fullscreen={workbenchFullscreen}
        onToggleFullscreen={toggleWorkbenchFullscreen}
        collapsed={workbenchCollapsed}
        onToggleCollapse={toggleWorkbenchCollapse}
        showTimeline={canShowIncidentTimeline && activeIncidentTimeline.length > 0}
        timelineDensity={incidentTimelineDensity}
        onTimelineDensityChange={(density) => {
          incidentTimelineDensity = density;
        }}
        timelineMarkers={visibleIncidentTimeline}
        activeTimelineMarkerId={incidentTimelineCursorId}
        onTimelineMarkerClick={(marker) => jumpToIncidentMarker(marker as IncidentMarker)}
      >
        {#snippet tabActions(tab)}
          {#if tab.kind === "yaml"}
            <button
              type="button"
              class={`rounded p-2 text-xs ${
                yamlCompareSourceTabId === tab.id
                  ? "bg-sky-100 text-sky-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onclick={() => selectYamlForCompare(tab.id)}
              title={yamlCompareSourceTabId === tab.id ? "Selected for compare" : "Select for compare"}
              aria-label={yamlCompareSourceTabId === tab.id ? "Selected for compare" : "Select for compare"}
            >
              <Target class="h-4 w-4" />
            </button>
            <button
              type="button"
              class={`rounded p-2 text-xs ${
                isYamlCompareTarget(tab.id)
                  ? "bg-sky-100 text-sky-900"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } disabled:opacity-50`}
              disabled={!canCompareWithSelected(tab.id)}
              onclick={() => compareYamlWithSelected(tab.id)}
              title={
                !yamlCompareSourceTabId
                  ? "Set as compare source"
                  : yamlCompareSourceTabId === tab.id
                    ? "Clear compare source"
                    : isYamlCompareTarget(tab.id)
                      ? "Disable compare"
                      : "Compare with selected"
              }
              aria-label="Compare with selected"
            >
              <GitCompareArrows class="h-4 w-4" />
            </button>
          {/if}
        {/snippet}
        {#snippet body()}
      {#if !workbenchCollapsed && activeWorkbenchTab}
        <div class={workbenchFullscreen ? "min-h-0 flex-1" : "h-[min(70dvh,760px)] min-h-[430px]"}>
          {#if workbenchLayout === "single"}
            {#if activeWorkbenchTab.kind === "logs"}
              {@const currentLogsTab = getLogsTab(activeWorkbenchTab.id)}
              <ResourceLogsSheet
                embedded={true}
                isOpen={workbenchOpen}
                podRef={currentLogsTab ? `${currentLogsTab.target.namespace}/${currentLogsTab.target.name}` : "-"}
                logs={currentLogsTab?.logsText ?? ""}
                loading={currentLogsTab?.logsLoading ?? false}
                error={currentLogsTab?.logsError ?? null}
                isLive={currentLogsTab?.logsLive ?? false}
                mode={currentLogsTab?.logsMode ?? "poll"}
                lastUpdatedAt={currentLogsTab?.logsUpdatedAt ?? null}
                previous={currentLogsTab?.logsPrevious ?? false}
                selectedContainer={currentLogsTab?.logsSelectedContainer ?? "all-containers"}
                containerOptions={currentLogsTab?.logsContainerOptions ?? ["all-containers"]}
                bookmarks={currentLogsTab?.bookmarks ?? []}
                onToggleLive={() => {
                  if (!currentLogsTab) return;
                  updateLogsTab(currentLogsTab.id, (tab) => ({ ...tab, logsLive: !tab.logsLive }));
                  startLiveLogsForTab(currentLogsTab.id);
                }}
                onSetMode={(mode) => {
                  if (!currentLogsTab) return;
                  updateLogsTab(currentLogsTab.id, (tab) => ({ ...tab, logsMode: mode, logsError: null }));
                  if (currentLogsTab.logsLive) startLiveLogsForTab(currentLogsTab.id);
                }}
                onTogglePrevious={() => {
                  if (!currentLogsTab) return;
                  updateLogsTab(currentLogsTab.id, (tab) => ({ ...tab, logsPrevious: !tab.logsPrevious }));
                  if (currentLogsTab.logsLive) startLiveLogsForTab(currentLogsTab.id);
                  else void loadLogsForTab(currentLogsTab.id);
                }}
                onSelectContainer={(container) => {
                  if (!currentLogsTab) return;
                  updateLogsTab(currentLogsTab.id, (tab) => ({ ...tab, logsSelectedContainer: container || "all-containers" }));
                  if (currentLogsTab.logsLive) startLiveLogsForTab(currentLogsTab.id);
                  else void loadLogsForTab(currentLogsTab.id);
                }}
                onRefresh={() => {
                  if (!currentLogsTab) return;
                  void loadLogsForTab(currentLogsTab.id);
                }}
                onAddBookmark={(line) => {
                  if (!currentLogsTab) return;
                  updateLogsTab(currentLogsTab.id, (tab) => ({
                    ...tab,
                    bookmarks: [
                      ...tab.bookmarks,
                      {
                        id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        line,
                        label: `Line ${line}`,
                        createdAt: Date.now(),
                      },
                    ],
                  }));
                }}
                onRemoveBookmark={(bookmarkId) => {
                  if (!currentLogsTab) return;
                  updateLogsTab(currentLogsTab.id, (tab) => ({
                    ...tab,
                    bookmarks: tab.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
                  }));
                }}
                jumpToLine={logsJumpToLine}
                onJumpHandled={() => {
                  logsJumpToLine = null;
                }}
              />
            {:else if activeWorkbenchTab.kind === "yaml"}
              {@const currentYamlTab = getYamlTab(activeWorkbenchTab.id)}
              <ResourceYamlSheet
                embedded={true}
                isOpen={workbenchOpen}
                podRef={currentYamlTab ? `${currentYamlTab.target.namespace}/${currentYamlTab.target.name}` : "-"}
                originalYaml={currentYamlTab?.yamlOriginalText ?? ""}
                yamlText={currentYamlTab?.yamlText ?? ""}
                loading={currentYamlTab?.yamlLoading ?? false}
                saving={currentYamlTab?.yamlSaving ?? false}
                hasChanges={(currentYamlTab?.yamlText ?? "") !== (currentYamlTab?.yamlOriginalText ?? "")}
                externalDiffLines={currentYamlTab ? getYamlCompareDiffLines(currentYamlTab.id) : []}
                error={currentYamlTab?.yamlError ?? null}
                onYamlChange={(value) => {
                  if (!currentYamlTab) return;
                  updateYamlTab(currentYamlTab.id, (tab) => ({ ...tab, yamlText: value }));
                }}
                onRefresh={() => {
                  if (!currentYamlTab) return;
                  void refreshYamlForTab(currentYamlTab.id);
                }}
                onSave={() => {
                  if (!currentYamlTab) return;
                  updateYamlTab(currentYamlTab.id, (tab) => ({
                    ...tab,
                    yamlError: "Apply YAML is not implemented for Stateful Sets yet.",
                  }));
                }}
              />
            {:else if activeWorkbenchTab.kind === "events"}
              {@const currentEventsTab = getEventsTab(activeWorkbenchTab.id)}
              <WorkloadEventsSheet
                embedded={true}
                isOpen={workbenchOpen}
                title={`Stateful set events: ${currentEventsTab ? `${currentEventsTab.target.namespace}/${currentEventsTab.target.name}` : "-"}`}
                targetRef={currentEventsTab ? `${currentEventsTab.target.namespace}/${currentEventsTab.target.name}` : "-"}
                events={currentEventsTab?.events ?? []}
                loading={currentEventsTab?.eventsLoading ?? false}
                error={currentEventsTab?.eventsError ?? null}
              />
            {:else}
              {@const currentRolloutTab = getRolloutTab(activeWorkbenchTab.id)}
              <WorkloadCommandOutputSheet
                embedded={true}
                isOpen={workbenchOpen}
                title={`${activeWorkbenchTab.kind === "rollout-status" ? "Rollout status" : "Rollout history"}: ${currentRolloutTab ? `${currentRolloutTab.target.namespace}/${currentRolloutTab.target.name}` : "-"}`}
                collapsedLabel={currentRolloutTab?.target.name ?? "Rollout"}
                commandLabel={
                  currentRolloutTab
                    ? buildRolloutCommandArgs(currentRolloutTab.mode, {
                        resource: "statefulset",
                        name: currentRolloutTab.target.name,
                        namespace: currentRolloutTab.target.namespace,
                      }).join(" ")
                    : null
                }
                output={currentRolloutTab?.output ?? ""}
                loading={currentRolloutTab?.loading ?? false}
                error={currentRolloutTab?.error ?? null}
                onRefresh={() => {
                  const target = currentRolloutTab?.target;
                  const statefulSet = target ? findStatefulSetItem(statefulSetsSnapshot, {
                    uid: `${target.namespace}/${target.name}`,
                    name: target.name,
                    namespace: target.namespace,
                  } as StatefulSetRow) : null;
                  if (!currentRolloutTab || !statefulSet) return;
                  void openRolloutCommandForStatefulSet(currentRolloutTab.mode, statefulSet);
                }}
              />
            {/if}
          {:else}
            <div class="flex h-full gap-2 p-2">
              {#each paneIndexes as paneIndex}
                {@const paneTab = getPaneTab(paneIndex)}
                <div class={`${getPaneWrapperClass(paneIndex)} min-h-0 overflow-hidden rounded border`}>
                  <div class="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                    <span class="text-muted-foreground">Pane {paneIndex + 1}</span>
                    <select
                      class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={paneTabIds[paneIndex] ?? ""}
                      onchange={(event) => {
                        const value = event.currentTarget.value;
                        assignTabToPane(paneIndex, value || null);
                      }}
                    >
                      <option value="">Select tab</option>
                      {#each orderedWorkbenchTabs as tab}
                        <option value={tab.id}>
                          {tab.title} · {tab.subtitle}
                        </option>
                      {/each}
                    </select>
                  </div>
                  {#if paneTab && paneTab.kind === "logs"}
                    {@const tab = getLogsTab(paneTab.id)}
                    <ResourceLogsSheet
                      embedded={true}
                      isOpen={workbenchOpen}
                      podRef={tab ? `${tab.target.namespace}/${tab.target.name}` : "-"}
                      logs={tab?.logsText ?? ""}
                      loading={tab?.logsLoading ?? false}
                      error={tab?.logsError ?? null}
                      isLive={tab?.logsLive ?? false}
                      mode={tab?.logsMode ?? "poll"}
                      lastUpdatedAt={tab?.logsUpdatedAt ?? null}
                      previous={tab?.logsPrevious ?? false}
                      selectedContainer={tab?.logsSelectedContainer ?? "all-containers"}
                      containerOptions={tab?.logsContainerOptions ?? ["all-containers"]}
                      bookmarks={tab?.bookmarks ?? []}
                      canVerticalCollapse={getPaneCount() > 1}
                      isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                      onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                      onToggleLive={() => {
                        if (!tab) return;
                        updateLogsTab(tab.id, (row) => ({ ...row, logsLive: !row.logsLive }));
                        startLiveLogsForTab(tab.id);
                      }}
                      onSetMode={(mode) => {
                        if (!tab) return;
                        updateLogsTab(tab.id, (row) => ({ ...row, logsMode: mode, logsError: null }));
                        if (tab.logsLive) startLiveLogsForTab(tab.id);
                      }}
                      onTogglePrevious={() => {
                        if (!tab) return;
                        updateLogsTab(tab.id, (row) => ({ ...row, logsPrevious: !row.logsPrevious }));
                        if (tab.logsLive) startLiveLogsForTab(tab.id);
                        else void loadLogsForTab(tab.id);
                      }}
                      onSelectContainer={(container) => {
                        if (!tab) return;
                        updateLogsTab(tab.id, (row) => ({ ...row, logsSelectedContainer: container || "all-containers" }));
                        if (tab.logsLive) startLiveLogsForTab(tab.id);
                        else void loadLogsForTab(tab.id);
                      }}
                      onRefresh={() => {
                        if (!tab) return;
                        void loadLogsForTab(tab.id);
                      }}
                      onAddBookmark={(line) => {
                        if (!tab) return;
                        updateLogsTab(tab.id, (row) => ({
                          ...row,
                          bookmarks: [
                            ...row.bookmarks,
                            { id: `bookmark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, line, label: `Line ${line}`, createdAt: Date.now() },
                          ],
                        }));
                      }}
                      onRemoveBookmark={(bookmarkId) => {
                        if (!tab) return;
                        updateLogsTab(tab.id, (row) => ({
                          ...row,
                          bookmarks: row.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
                        }));
                      }}
                      jumpToLine={logsJumpToLine}
                      onJumpHandled={() => {
                        logsJumpToLine = null;
                      }}
                    />
                  {:else if paneTab && paneTab.kind === "yaml"}
                    {@const tab = getYamlTab(paneTab.id)}
                    <ResourceYamlSheet
                      embedded={true}
                      isOpen={workbenchOpen}
                      podRef={tab ? `${tab.target.namespace}/${tab.target.name}` : "-"}
                      originalYaml={tab?.yamlOriginalText ?? ""}
                      yamlText={tab?.yamlText ?? ""}
                      loading={tab?.yamlLoading ?? false}
                      saving={tab?.yamlSaving ?? false}
                      hasChanges={(tab?.yamlText ?? "") !== (tab?.yamlOriginalText ?? "")}
                      externalDiffLines={tab ? getYamlCompareDiffLines(tab.id) : []}
                      error={tab?.yamlError ?? null}
                      canVerticalCollapse={getPaneCount() > 1}
                      isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                      onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                      onYamlChange={(value) => {
                        if (!tab) return;
                        updateYamlTab(tab.id, (row) => ({ ...row, yamlText: value }));
                      }}
                      onRefresh={() => {
                        if (!tab) return;
                        void refreshYamlForTab(tab.id);
                      }}
                      onSave={() => {
                        if (!tab) return;
                        updateYamlTab(tab.id, (row) => ({
                          ...row,
                          yamlError: "Apply YAML is not implemented for Stateful Sets yet.",
                        }));
                      }}
                    />
                  {:else if paneTab && paneTab.kind === "events"}
                    {@const tab = getEventsTab(paneTab.id)}
                    <WorkloadEventsSheet
                      embedded={true}
                      isOpen={workbenchOpen}
                      title={`Stateful set events: ${tab ? `${tab.target.namespace}/${tab.target.name}` : "-"}`}
                      targetRef={tab ? `${tab.target.namespace}/${tab.target.name}` : "-"}
                      events={tab?.events ?? []}
                      loading={tab?.eventsLoading ?? false}
                      error={tab?.eventsError ?? null}
                      canVerticalCollapse={getPaneCount() > 1}
                      isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                      onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                    />
                  {:else if paneTab && (paneTab.kind === "rollout-status" || paneTab.kind === "rollout-history")}
                    {@const tab = getRolloutTab(paneTab.id)}
                    <WorkloadCommandOutputSheet
                      embedded={true}
                      isOpen={workbenchOpen}
                      title={`${paneTab.kind === "rollout-status" ? "Rollout status" : "Rollout history"}: ${tab ? `${tab.target.namespace}/${tab.target.name}` : "-"}`}
                      collapsedLabel={tab?.target.name ?? "Rollout"}
                      commandLabel={
                        tab
                          ? buildRolloutCommandArgs(tab.mode, {
                              resource: "statefulset",
                              name: tab.target.name,
                              namespace: tab.target.namespace,
                            }).join(" ")
                          : null
                      }
                      output={tab?.output ?? ""}
                      loading={tab?.loading ?? false}
                      error={tab?.error ?? null}
                      canVerticalCollapse={getPaneCount() > 1}
                      isVerticallyCollapsed={isPaneCollapsed(paneIndex)}
                      onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                      onRefresh={() => {
                        if (!tab) return;
                        const statefulSet = findStatefulSetItem(statefulSetsSnapshot, {
                          uid: `${tab.target.namespace}/${tab.target.name}`,
                          name: tab.target.name,
                          namespace: tab.target.namespace,
                        } as StatefulSetRow);
                        if (!statefulSet) return;
                        void openRolloutCommandForStatefulSet(tab.mode, statefulSet);
                      }}
                    />
                  {:else}
                    <div class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
                      Select tab for pane {paneIndex + 1}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
        {/snippet}
      </MultiPaneWorkbench>
    </div>
  {/if}
  {#if selectedCount > 0}
    <WorkloadSelectionBar count={selectedCount}>
      {#snippet children()}
        <StatefulSetBulkActions
          mode={selectedCount === 1 ? "single" : "multi"}
          disabled={actionInFlight}
          onShowDetails={() => {
            if (selectedStatefulSets.length !== 1) return;
            openSheet(selectedStatefulSets[0]);
          }}
          onLogs={() => {
            if (selectedStatefulSets.length !== 1) return;
            openLogsForStatefulSet(selectedStatefulSets[0]);
          }}
          onEvents={() => {
            if (selectedStatefulSets.length !== 1) return;
            void openEventsForStatefulSet(selectedStatefulSets[0]);
          }}
          onEditYaml={() => {
            if (selectedStatefulSets.length !== 1) return;
            openYamlForStatefulSet(selectedStatefulSets[0]);
          }}
          onInvestigate={() => {
            if (selectedStatefulSets.length !== 1) return;
            openStatefulSetInvestigationWorkspace(selectedStatefulSets[0]);
          }}
          onCopyDescribe={() => {
            if (selectedStatefulSets.length !== 1) return;
            void copyDescribeCommandForStatefulSet(selectedStatefulSets[0]);
          }}
          onRunDebugDescribe={() => {
            if (selectedStatefulSets.length !== 1) return;
            openDebugDescribeForStatefulSet(selectedStatefulSets[0]);
          }}
          onDownloadYaml={() => {
            void downloadYamlForStatefulSets(selectedStatefulSets);
          }}
          onRolloutStatus={() => {
            if (selectedStatefulSets.length !== 1) return;
            void openRolloutCommandForStatefulSet("status", selectedStatefulSets[0]);
          }}
          onRolloutHistory={() => {
            if (selectedStatefulSets.length !== 1) return;
            void openRolloutCommandForStatefulSet("history", selectedStatefulSets[0]);
          }}
          onScale={() => {
            void scaleStatefulSets(selectedStatefulSets);
          }}
          onRestart={() => {
            void restartStatefulSets(selectedStatefulSets);
          }}
          onDelete={() => {
            void deleteStatefulSets(selectedStatefulSets);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={actionInFlight}
          onclick={() => {
            selectedStatefulSetIds = new Set<string>();
          }}
        >
          Clear
        </Button>
      {/snippet}
    </WorkloadSelectionBar>
  {/if}
  <ResourceSummaryStrip
    items={[
      { label: "Cluster", value: resolvePageClusterName(data), tone: "foreground" },
      { label: "Namespace", value: statefulSetsNamespaceSummary },
      { label: "Stateful Sets", value: rows.length },
      { label: "Sync", value: statefulSetsRuntimeSourceState },
    ]}
    trailingItem={{
      label: "View",
      value: statefulSetsSummaryView,
      valueClass: "text-foreground",
    }}
  />
  <div class="mb-4">
    <SectionRuntimeStatus
      sectionLabel="Stateful Sets Runtime Status"
      profileLabel={statefulSetsRuntimeProfileLabel}
      sourceState={statefulSetsRuntimeSourceState}
      mode={watcherPolicy.mode === "stream" ? "stream" : "poll"}
      budgetSummary={`sync ${watcherPolicy.refreshSeconds}s`}
      lastUpdatedLabel={statefulSetsRuntimeLastUpdatedLabel}
      detail={statefulSetsRuntimeDetail}
      secondaryActionLabel="Update"
      secondaryActionAriaLabel="Refresh stateful sets runtime section"
      secondaryActionLoading={watcherInFlight}
      onSecondaryAction={() => void refreshStatefulSetsFromWatcher("manual")}
      reason={statefulSetsRuntimeReason}
      actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
      actionAriaLabel={watcherEnabled ? "Pause stateful sets runtime section" : "Resume stateful sets runtime section"}
      onAction={toggleWatcher}
    />
  </div>
  <DataTable
    data={rows}
    {columns}
    isRowSelected={(row) => isStatefulSetSelected(row.uid)}
    onToggleGroupSelection={toggleGroupSelection}
    {watcherEnabled}
    {watcherRefreshSeconds}
    {watcherError}
    viewMode={statefulSetsTableViewMode}
    onViewModeChange={setViewMode}
    onToggleWatcher={toggleWatcher}
    onWatcherRefreshSecondsChange={setWatcherRefreshSeconds}
    onResetWatcherSettings={resetWatcherSettings}
    onCsvDownloaded={({ pathHint, rows: csvRows }) => {
      actionNotification = notifySuccess(`CSV exported: ${pathHint} (${csvRows} rows).`);
    }}
    onRowClick={(row) => {
      const item = findStatefulSetItem(statefulSets, row);
      if (item) openSheet(item);
    }}
  />
</div>
<ResourceDetailsSheet
  clusterId={data.slug}
  title="Stateful Set"
  selectedItem={selectedItem}
  isOpen={isSheetOpen}
  runtimeProfileLabel={statefulSetsRuntimeProfileLabel}
  runtimeSourceState={statefulSetsRuntimeSourceState}
  runtimeLastUpdatedLabel={statefulSetsRuntimeLastUpdatedLabel}
  runtimeDetail={statefulSetsRuntimeDetail}
  runtimeReason={statefulSetsRuntimeReason}
  runtimeRequestPath={watcherPolicy.mode === "stream" ? "kubectl watch stream for stateful sets" : `poll every ${watcherPolicy.refreshSeconds}s`}
  runtimeSyncError={watcherError}
  events={detailsEvents}
  eventsLoading={detailsLoading}
  eventsError={detailsError}
  onLogs={(item) => {
    void openLogsForStatefulSet(item as unknown as StatefulSetItem);
  }}
  onEvents={(item) => {
    void openEventsForStatefulSet(item as unknown as StatefulSetItem);
  }}
  onScale={(item) => {
    void scaleStatefulSets([item as unknown as StatefulSetItem]);
  }}
  onEditYaml={(item) => {
    void openYamlForStatefulSet(item as unknown as StatefulSetItem);
  }}
  onInvestigate={(item) => {
    void openStatefulSetInvestigationWorkspace(item as unknown as StatefulSetItem);
  }}
  onCopyDescribe={(item) => {
    void copyDescribeCommandForStatefulSet(item as unknown as StatefulSetItem);
  }}
  onRunDebugDescribe={(item) => {
    openDebugDescribeForStatefulSet(item as unknown as StatefulSetItem);
  }}
  onDownloadYaml={(item) => {
    void downloadYamlForStatefulSets([item as unknown as StatefulSetItem]);
  }}
  onRolloutStatus={(item) => {
    void openRolloutCommandForStatefulSet("status", item as unknown as StatefulSetItem);
  }}
  onRolloutHistory={(item) => {
    void openRolloutCommandForStatefulSet("history", item as unknown as StatefulSetItem);
  }}
  onRestart={(item) => {
    void restartStatefulSets([item as unknown as StatefulSetItem]);
  }}
  onDelete={(item) => {
    void deleteStatefulSets([item as unknown as StatefulSetItem]);
  }}
/>
