<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import { onDestroy, onMount } from "svelte";
  import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import Target from "@lucide/svelte/icons/target";
  import X from "@lucide/svelte/icons/x";
  import type { ColumnDef } from "@tanstack/table-core";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import {
    applyJobEvent,
    destroyJobsSync,
    initJobsSync,
    markJobsSyncError,
    markJobsSyncLoading,
    markJobsSyncSuccess,
    resetJobsSyncStatus,
    selectClusterJobs,
    setInitialJobs,
    setJobsSyncEnabled,
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
  import type { JobItem } from "$shared/model/clusters";
  import DataTable, {
    type JobsTableViewMode,
  } from "./jobs-list/data-table.svelte";
  import ResourceLogsSheet from "./common/resource-logs-sheet.svelte";
  import ResourceYamlSheet from "./common/resource-yaml-sheet.svelte";
  import ResourceDetailsSheet from "./resource-details-sheet.svelte";
  import { writable } from "svelte/store";
  import {
    findJobItem,
    getFilteredJobs,
    mapJobRows,
    pruneSelectedJobIds,
    type JobRow,
  } from "./jobs-list/model";
  import ResourceActionsMenu from "./common/resource-actions-menu.svelte";
  import JobBulkActions from "./jobs-list/job-bulk-actions.svelte";
  import JobConditionBadge from "./jobs-list/job-condition-badge.svelte";
  import JobSelectionCheckbox from "./jobs-list/job-selection-checkbox.svelte";
  import {
    getJobsWorkbenchStateKey,
    parseJobsWorkbenchState,
    type PersistedJobsWorkbenchState,
  } from "./jobs-list/workbench-session";
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

  interface JobsListProps {
    data: PageData & { jobs?: JobItem[] };
  }

  const { data }: JobsListProps = $props();
  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
    viewMode: JobsTableViewMode;
  };
  const WATCHER_SETTINGS_PREFIX = "dashboard.jobs.watcher.settings.v1";
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
    kind: "logs" | "yaml";
    title: string;
    subtitle: string;
  };
  type ClosedWorkbenchTab = {
    kind: "logs" | "yaml";
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

  const columns: ColumnDef<JobRow>[] = [
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
        return renderComponent(JobSelectionCheckbox, {
          checked: allSelected,
          indeterminate: hasSomeSelected,
          label: "Select all jobs",
          onToggle: (next: boolean) => toggleAllSelection(next),
        });
      },
      cell: ({ row }) => {
        return renderComponent(JobSelectionCheckbox, {
          checked: isJobSelected(row.original.uid),
          label: `Select job ${row.original.name}`,
          onToggle: (next: boolean) => {
            toggleJobSelection(row.original.uid, next);
          },
        });
      },
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const job = findJobItem(jobsSnapshot, row.original);
        return renderComponent(ResourceActionsMenu, {
          name: row.original.name,
          namespace: row.original.namespace,
          disabled: !job,
          isBusy: actionInFlight,
          onShowDetails: () => {
            if (job) openSheet(job);
          },
          onLogs: () => {
            if (job) openLogsForJob(job);
          },
          onEditYaml: () => {
            if (job) openYamlForJob(job);
          },
          onInvestigate: () => {
            if (job) openJobInvestigationWorkspace(job);
          },
          onCopyDescribe: () => {
            if (job) void copyDescribeCommandForJob(job);
          },
          onRunDebugDescribe: () => {
            if (job) openDebugDescribeForJob(job);
          },
          onDownloadYaml: () => {
            if (job) void downloadYamlForJobs([job]);
          },
          onDelete: () => {
            if (job) void deleteJobs([job]);
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
    { accessorKey: "completions", header: "Completions" },
    {
      accessorKey: "age",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Age",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    {
      accessorKey: "status",
      header: "Conditions",
      cell: ({ row }) =>
        renderComponent(JobConditionBadge, {
          status: row.original.status,
        }),
    },
  ];

  let jobsSnapshot = $state<JobItem[]>([]);
  let selectedJobIds = $state(new Set<string>());
  const jobs = $derived.by(() => {
    return getFilteredJobs(jobsSnapshot, $selectedNamespace);
  });
  const rows = $derived.by(() =>
    mapJobRows(jobs, (creationTimestamp) =>
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
    availableIds.length > 0 && availableIds.every((id) => selectedJobIds.has(id)),
  );
  const hasSomeSelected = $derived(selectedJobIds.size > 0 && !allSelected);
  const selectedCount = $derived(selectedJobIds.size);
  const selectedJobs = $derived.by(() => {
    const selected = new Set(selectedJobIds);
    return jobs.filter((item) => {
      const namespace = item.metadata?.namespace ?? "default";
      const name = item.metadata?.name ?? "-";
      return selected.has(`${namespace}/${name}`);
    });
  });
  const selectedItem = writable<JobItem | null>(null);
  const isSheetOpen = writable(false);
  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let jobsTableViewMode = $state<JobsTableViewMode>(DEFAULT_WATCHER_SETTINGS.viewMode);
  let watcherError = $state<string | null>(null);
  let lastWatcherSuccessAt = $state<number | null>(null);
  let runtimeClockNow = $state(Date.now());
  let watcherInFlight = $state(false);
  let watcherSettingsLoadedCluster = $state<string | null>(null);
  let jobsSyncStarted = false;
  let jobsSyncStoreUnsubscribe: (() => void) | null = null;
  const watcherPolicy = $derived.by(() =>
    resolveCoreResourceSyncPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
      supportsStream: true,
    }),
  );
  const watcherEngine = createWorkloadWatcher({
    workloadName: "jobs",
    isEnabled: () => watcherPolicy.enabled,
    getRefreshSeconds: () => watcherPolicy.refreshSeconds,
    onTick: async () => {
      await refreshJobsFromWatcher();
    },
  });
  const mutationReconcile = createMutationReconcile({
    isSyncEnabled: () => watcherPolicy.enabled,
    getSyncMode: () => watcherPolicy.mode,
    getClusterId: () => data?.slug ?? null,
    getScopeKey: () => "job",
    refresh: () => refreshJobsFromWatcher(),
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
  const jobsRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const jobsRuntimeSourceState = $derived.by(() => {
    if (!watcherPolicy.enabled) return "paused";
    if (watcherError && jobsSnapshot.length > 0) return "cached";
    if (watcherError) return "error";
    if (watcherIsStale) return "stale";
    if (watcherInFlight && jobsSnapshot.length > 0) return "cached";
    if (lastWatcherSuccessAt) return "live";
    if (jobsSnapshot.length > 0) return "cached";
    return "idle";
  });
  const jobsRuntimeLastUpdatedLabel = $derived.by(() => {
    void runtimeClockNow;
    if (!lastWatcherSuccessAt) return null;
    return `updated ${getTimeDifference(new Date(lastWatcherSuccessAt))} ago`;
  });
  const jobsRuntimeDetail = $derived.by(() => {
    if (!watcherPolicy.enabled) return "Job sync is paused until you refresh or re-enable the watcher.";
    if (watcherError && jobsSnapshot.length > 0) {
      return "Showing the last successful job snapshot while background refresh is degraded.";
    }
    if (watcherError) return "Job sync is degraded and needs operator attention.";
    if (watcherIsStale) return "Job data has exceeded the freshness budget and should be refreshed.";
    if (watcherInFlight) return "Background job refresh is currently in flight.";
    return "Job sync is operating within the current runtime budget.";
  });
  const jobsRuntimeReason = $derived.by(() => {
    if (watcherError) return watcherError;
    return watcherPolicy.mode === "stream"
      ? "Streaming watcher active for jobs."
      : `Polling jobs every ${watcherPolicy.refreshSeconds}s.`;
  });
  const jobsNamespaceSummary = $derived($selectedNamespace || "all");
  const jobsSummaryView = $derived(jobsTableViewMode === "namespace" ? "By namespace" : "Flat");
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);
  let incidentTimelineCursorId = $state<string | null>(null);
  let incidentTimelineDensity = $state<"all" | "warnings">("all");
  let pendingWorkbenchState = $state<PersistedJobsWorkbenchState | null | undefined>(undefined);
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

  function openSheet(item: JobItem) {
    selectedItem.set(item);
    isSheetOpen.set(true);
    void loadDetailsEvents(item);
  }

  async function loadDetailsEvents(item: JobItem) {
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
            `involvedObject.kind=Job,involvedObject.name=${name}`,
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
        detailsError = error instanceof Error ? error.message : "Failed to load job details.";
        detailsEvents = [];
      } finally {
        if (isLatest()) detailsLoading = false;
      }
    });
  }

  function invalidateJobsSnapshotCache() {
    invalidateWorkloadSnapshotCache(data?.slug, "jobs");
  }

  function getJobRef(item: JobItem) {
    const namespace = item.metadata?.namespace ?? "default";
    const name = item.metadata?.name ?? "-";
    return `${namespace}/${name}`;
  }

  function getJobContainers(item: JobItem) {
    return item.spec?.template?.spec?.containers?.map((container) => container?.name).filter(Boolean) ?? [];
  }

  function getLogsTab(tabId: string) {
    return logsTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function getYamlTab(tabId: string) {
    return yamlTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updateLogsTab(tabId: string, updater: (tab: LogsTabState) => LogsTabState) {
    logsTabs = logsTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
  }

  function updateYamlTab(tabId: string, updater: (tab: YamlTabState) => YamlTabState) {
    yamlTabs = yamlTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
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
    const target = tab.kind === "logs" ? logsTab?.target ?? null : yamlTab?.target ?? null;
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
    } else {
      yamlTabs = yamlTabs.filter((tab) => tab.id !== tabId);
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
    const job =
      jobsSnapshot.find(
        (item) =>
          item.metadata?.name === entry.target?.name &&
          (item.metadata?.namespace ?? "default") === entry.target?.namespace,
      ) ?? null;
    if (!job) return;
    if (entry.kind === "logs") {
      await openLogsForJob(job);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `logs:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    await openYamlForJob(job);
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
      `job/${tab.target.name}`,
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
        `job/${tab.target.name}`,
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
          throw new Error(response.errors || "Failed to load job logs.");
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
          logsError: error instanceof Error ? error.message : "Failed to load job logs.",
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
          ["get", "job", tab.target.name, "--namespace", tab.target.namespace, "-o", "yaml"],
          { clusterId: data.slug, signal },
        );
        if (!isLatest()) return;
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || "Failed to load job YAML.");
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
          yamlError: error instanceof Error ? error.message : "Failed to load job YAML.",
        }));
      }
    });
  }

  async function openLogsForJob(item: JobItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const tabId = `logs:${namespace}/${name}`;
    const existing = getLogsTab(tabId);
    const containers = getJobContainers(item);
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

  async function openYamlForJob(item: JobItem) {
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

  async function openJobInvestigationWorkspace(item: JobItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const logsTabId = `logs:${namespace}/${name}`;
    const yamlTabId = `yaml:${namespace}/${name}`;
    await openLogsForJob(item);
    await openYamlForJob(item);
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

  async function copyDescribeCommandForJob(item: JobItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    const command = buildKubectlDescribeCommand({
      resource: "jobs",
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

  function openDebugDescribeForJob(item: JobItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    runDebugDescribe({
      clusterId: data.slug,
      resource: "job",
      name,
      namespace,
      title: `Describe job ${namespace}/${name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${namespace}/${name}.`);
    actionNotification = null;
  }

  async function downloadYamlForJobs(items: JobItem[]) {
    if (!data?.slug || items.length === 0) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["get", "job", name, "--namespace", namespace, "-o", "yaml"],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to download YAML for ${namespace}/${name}.`);
        }
        const filename = buildYamlFilename("job", namespace, name);
        await writeTextFile(filename, response.output || "", { baseDir: BaseDirectory.Download });
      }
      if (items.length === 1) {
        const only = items[0];
        const onlyName = only.metadata?.name ?? "job";
        const onlyNs = only.metadata?.namespace ?? "default";
        yamlDownloadMessage = `Job YAML exported: ${onlyNs}/${onlyName} -> ~/Downloads/${buildYamlFilename("job", onlyNs, onlyName)}`;
      } else {
        yamlDownloadMessage = `Job YAML export completed: ${items.length} files in ~/Downloads.`;
      }
    } catch (error) {
      yamlDownloadError = error instanceof Error ? error.message : "Failed to download YAML.";
    } finally {
      actionInFlight = false;
    }
  }


  async function deleteJobs(items: JobItem[]) {
    if (!data?.slug || items.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${items.length} job${items.length === 1 ? "" : "s"}? This cannot be undone.`,
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
          ["delete", "job", name, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to delete ${namespace}/${name}.`);
        }
      }
      selectedJobIds = new Set<string>();
      if (items.length === 1) {
        actionNotification = notifySuccess(`Deleted Job ${getJobRef(items[0])}.`);
      } else {
        actionNotification = notifySuccess(`Deleted ${items.length} Jobs.`);
      }
      removeJobsFromSnapshot(items);
      invalidateJobsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["DELETED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to delete jobs.");
    } finally {
      actionInFlight = false;
    }
  }

  function isJobSelected(id: string) {
    return selectedJobIds.has(id);
  }

  function toggleJobSelection(id: string, next?: boolean) {
    if (!id) return;
    const shouldSelect = typeof next === "boolean" ? next : !selectedJobIds.has(id);
    const updated = new Set(selectedJobIds);
    if (shouldSelect) updated.add(id);
    else updated.delete(id);
    selectedJobIds = updated;
  }

  function toggleAllSelection(next?: boolean) {
    if (availableIds.length === 0) {
      selectedJobIds = new Set<string>();
      return;
    }
    const shouldSelectAll =
      typeof next === "boolean" ? next : availableIds.some((id) => !selectedJobIds.has(id));
    selectedJobIds = shouldSelectAll ? new Set(availableIds) : new Set<string>();
  }

  function toggleGroupSelection(_groupKey: string, next: boolean, rowIds: string[]) {
    const updated = new Set(selectedJobIds);
    if (next) rowIds.forEach((id) => updated.add(id));
    else rowIds.forEach((id) => updated.delete(id));
    selectedJobIds = updated;
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
      viewMode: jobsTableViewMode,
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

  function bindJobsSyncStore(clusterId: string) {
    jobsSyncStoreUnsubscribe?.();
    jobsSyncStoreUnsubscribe = selectClusterJobs(clusterId).subscribe((items) => {
      jobsSnapshot = items as JobItem[];
      lastWatcherSuccessAt = Date.now();
    });
  }

  async function refreshJobsFromWatcher(source: "manual" | "watcher" = "watcher") {
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
    markJobsSyncLoading(data.slug);
    try {
      jobsSnapshot = await fetchNamespacedSnapshotItems<JobItem>({
        clusterId: data.slug,
        selectedNamespace: $selectedNamespace,
        resource: "jobs",
        errorMessage: "Jobs watcher sync failed.",
      });
      lastWatcherSuccessAt = Date.now();
      markJobsSyncSuccess(data.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Jobs watcher sync failed.";
      watcherError = message;
      markJobsSyncError(data.slug, message);
    } finally {
      watcherInFlight = false;
    }
  }

  function applyWatcherMode() {
    if (!data?.slug) return;
    if (watcherPolicy.enabled) {
      setJobsSyncEnabled(data.slug, true);
      if (watcherPolicy.mode === "stream") {
        stopWatcherTimer();
        bindJobsSyncStore(data.slug);
        initJobsSync(data.slug, Array.isArray(data.jobs) ? data.jobs : []);
        jobsSyncStarted = true;
      } else {
        if (jobsSyncStarted) {
          destroyJobsSync(data.slug);
          jobsSyncStarted = false;
        }
        startWatcherTimer();
      }
      void refreshJobsFromWatcher();
      return;
    }
    setJobsSyncEnabled(data.slug, false);
    stopWatcherTimer();
    if (jobsSyncStarted) {
      destroyJobsSync(data.slug);
      jobsSyncStarted = false;
    }
  }

  function removeJobsFromSnapshot(items: JobItem[]) {
    const keys = new Set(
      items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
    );
    if (watcherPolicy.mode === "stream" && data?.slug) {
      for (const item of items) {
        applyJobEvent(data.slug, { type: "DELETED", object: item });
      }
      return;
    }
    jobsSnapshot = jobsSnapshot.filter((item) => {
      const key = `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`;
      return !keys.has(key);
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

  function setViewMode(mode: JobsTableViewMode) {
    jobsTableViewMode = mode;
    persistWatcherSettings();
  }

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    jobsTableViewMode = DEFAULT_WATCHER_SETTINGS.viewMode;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function parseWorkbenchTabId(tabId: string): { kind: "logs" | "yaml"; name: string; namespace: string } | null {
    const match = /^(logs|yaml):([^/]+)\/(.+)$/.exec(tabId);
    if (!match) return null;
    return {
      kind: match[1] as "logs" | "yaml",
      namespace: match[2],
      name: match[3],
    };
  }

  function clearWorkbenchState(clusterId: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(getJobsWorkbenchStateKey(clusterId));
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
    const payload: PersistedJobsWorkbenchState = {
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
      window.localStorage.setItem(getJobsWorkbenchStateKey(data.slug), JSON.stringify(payload));
    } catch {
      // Ignore localStorage failures.
    }
  }

  function loadWorkbenchState(clusterId: string) {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(getJobsWorkbenchStateKey(clusterId));
      return parseJobsWorkbenchState(raw);
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
          jobsSnapshot.find(
            (entry) =>
              entry.metadata?.name === tab.name &&
              (entry.metadata?.namespace ?? "default") === tab.namespace,
          ) ?? null;
        return item ? { tab, item } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (state.tabs.length > 0 && entries.length === 0 && jobsSnapshot.length === 0) {
      return;
    }
    for (const entry of entries) {
      if (entry.tab.kind === "logs") {
        void openLogsForJob(entry.item);
      } else {
        void openYamlForJob(entry.item);
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
    setInitialJobs(data.slug, data.jobs ?? []);
    if (watcherPolicy.mode !== "stream") {
      jobsSnapshot = data.jobs ?? [];
    }
  });

  $effect(() => {
    const nextSelection = pruneSelectedJobIds(selectedJobIds, availableIds);
    if (nextSelection !== selectedJobIds) {
      selectedJobIds = nextSelection;
    }
  });

  $effect(() => {
    jobsSnapshot;
    tryRestorePendingWorkbenchState();
  });

  $effect(() => {
    if (!data?.slug) return;
    if (!workbenchStateRestored) return;
    if (workbenchTabs.length > 0) return;
    if (logsTabs.length > 0 || yamlTabs.length > 0) return;
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
      setJobsSyncEnabled(previousClusterId, false);
      resetJobsSyncStatus(previousClusterId);
      if (jobsSyncStarted) {
        destroyJobsSync(previousClusterId);
        jobsSyncStarted = false;
      }
      jobsSyncStoreUnsubscribe?.();
      jobsSyncStoreUnsubscribe = null;
    }

    const settings = loadWatcherSettings(clusterId);
    watcherEnabled = settings.enabled;
    watcherRefreshSeconds = settings.refreshSeconds;
    jobsTableViewMode = settings.viewMode;
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
    jobsSyncStoreUnsubscribe?.();
    jobsSyncStoreUnsubscribe = null;
    stopAllLiveLogs();
    if (!data?.slug) return;
    destroyJobsSync(data.slug);
    resetJobsSyncStatus(data.slug);
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
            {:else}
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
                    yamlError: "Apply YAML is not implemented for Jobs yet.",
                  }));
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
                          yamlError: "Apply YAML is not implemented for Jobs yet.",
                        }));
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
        <JobBulkActions
          mode={selectedCount === 1 ? "single" : "multi"}
          disabled={actionInFlight}
          onShowDetails={() => {
            if (selectedJobs.length !== 1) return;
            openSheet(selectedJobs[0]);
          }}
          onLogs={() => {
            if (selectedJobs.length !== 1) return;
            openLogsForJob(selectedJobs[0]);
          }}
          onEditYaml={() => {
            if (selectedJobs.length !== 1) return;
            openYamlForJob(selectedJobs[0]);
          }}
          onInvestigate={() => {
            if (selectedJobs.length !== 1) return;
            openJobInvestigationWorkspace(selectedJobs[0]);
          }}
          onCopyDescribe={() => {
            if (selectedJobs.length !== 1) return;
            void copyDescribeCommandForJob(selectedJobs[0]);
          }}
          onRunDebugDescribe={() => {
            if (selectedJobs.length !== 1) return;
            openDebugDescribeForJob(selectedJobs[0]);
          }}
          onDownloadYaml={() => {
            void downloadYamlForJobs(selectedJobs);
          }}
          onDelete={() => {
            void deleteJobs(selectedJobs);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={actionInFlight}
          onclick={() => {
            selectedJobIds = new Set<string>();
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
      { label: "Namespace", value: jobsNamespaceSummary },
      { label: "Jobs", value: rows.length },
      { label: "Sync", value: jobsRuntimeSourceState },
    ]}
    trailingItem={{
      label: "View",
      value: jobsSummaryView,
      valueClass: "text-foreground",
    }}
  />
  <div class="mb-4">
    <SectionRuntimeStatus
      sectionLabel="Jobs Runtime Status"
      profileLabel={jobsRuntimeProfileLabel}
      sourceState={jobsRuntimeSourceState}
      mode={watcherPolicy.mode === "stream" ? "stream" : "poll"}
      budgetSummary={`sync ${watcherPolicy.refreshSeconds}s`}
      lastUpdatedLabel={jobsRuntimeLastUpdatedLabel}
      detail={jobsRuntimeDetail}
      secondaryActionLabel="Update"
      secondaryActionAriaLabel="Refresh jobs runtime section"
      secondaryActionLoading={watcherInFlight}
      onSecondaryAction={() => void refreshJobsFromWatcher("manual")}
      reason={jobsRuntimeReason}
      actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
      actionAriaLabel={watcherEnabled ? "Pause jobs runtime section" : "Resume jobs runtime section"}
      onAction={toggleWatcher}
    />
  </div>
  <DataTable
    data={rows}
    {columns}
    isRowSelected={(row) => isJobSelected(row.uid)}
    onToggleGroupSelection={toggleGroupSelection}
    {watcherEnabled}
    {watcherRefreshSeconds}
    {watcherError}
    viewMode={jobsTableViewMode}
    onViewModeChange={setViewMode}
    onToggleWatcher={toggleWatcher}
    onWatcherRefreshSecondsChange={setWatcherRefreshSeconds}
    onResetWatcherSettings={resetWatcherSettings}
    onCsvDownloaded={({ pathHint, rows: csvRows }) => {
      actionNotification = notifySuccess(`CSV exported: ${pathHint} (${csvRows} rows).`);
    }}
    onRowClick={(row) => {
      const item = findJobItem(jobs, row);
      if (item) openSheet(item);
    }}
  />
</div>
<ResourceDetailsSheet
  clusterId={data.slug}
  title="Job"
  selectedItem={selectedItem}
  isOpen={isSheetOpen}
  runtimeProfileLabel={jobsRuntimeProfileLabel}
  runtimeSourceState={jobsRuntimeSourceState}
  runtimeLastUpdatedLabel={jobsRuntimeLastUpdatedLabel}
  runtimeDetail={jobsRuntimeDetail}
  runtimeReason={jobsRuntimeReason}
  runtimeRequestPath={watcherPolicy.mode === "stream" ? "kubectl watch stream for jobs" : `poll every ${watcherPolicy.refreshSeconds}s`}
  runtimeSyncError={watcherError}
  events={detailsEvents}
  eventsLoading={detailsLoading}
  eventsError={detailsError}
  onLogs={(item) => {
    void openLogsForJob(item as unknown as JobItem);
  }}
  onEditYaml={(item) => {
    void openYamlForJob(item as unknown as JobItem);
  }}
  onInvestigate={(item) => {
    void openJobInvestigationWorkspace(item as unknown as JobItem);
  }}
  onCopyDescribe={(item) => {
    void copyDescribeCommandForJob(item as unknown as JobItem);
  }}
  onRunDebugDescribe={(item) => {
    openDebugDescribeForJob(item as unknown as JobItem);
  }}
  onDownloadYaml={(item) => {
    void downloadYamlForJobs([item as unknown as JobItem]);
  }}
  onDelete={(item) => {
    void deleteJobs([item as unknown as JobItem]);
  }}
/>
