<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";
  import { createRawSnippet, onDestroy, onMount, tick } from "svelte";
  import { writable } from "svelte/store";
  import type { ColumnDef } from "@tanstack/table-core";
  import { path } from "@tauri-apps/api";
  import { BaseDirectory, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
  import { load as parseYaml, YAMLException } from "js-yaml";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import FileDown from "@lucide/svelte/icons/file-down";
  import Info from "@lucide/svelte/icons/info";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Pause from "@lucide/svelte/icons/pause";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Play from "@lucide/svelte/icons/play";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Target from "@lucide/svelte/icons/target";
  import Trash from "@lucide/svelte/icons/trash";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import X from "@lucide/svelte/icons/x";
  import { ChevronDown, ChevronUp } from "$shared/ui/icons";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import { getDeploymentStatus } from "$entities/deployment";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { getTimeDifference, type DeploymentItem } from "$shared";
  import { renderComponent, renderSnippet } from "$shared/ui/data-table";
  import { Button, SortingButton } from "$shared/ui/button";
  import { confirmAction } from "$shared/lib/confirm-action";
  import * as Alert from "$shared/ui/alert";
  import { namespaceMatches, selectedNamespace } from "$features/namespace-management";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import { trackWorkloadEvent } from "$features/workloads-management";
  import {
    applyDeploymentEvent,
    destroyDeploymentsSync,
    initDeploymentsSync,
    markDeploymentsSyncError,
    markDeploymentsSyncLoading,
    markDeploymentsSyncSuccess,
    resetDeploymentsSyncStatus,
    selectClusterDeployments,
    setInitialDeployments,
    setDeploymentsSyncEnabled,
  } from "$features/check-health";
  import { checkYamlDrift, buildDriftMessage } from "$features/pod-yaml-editor";
  import {
    computeLayoutClosePlan,
    formatApplyErrorMessage,
    buildIncidentTimeline,
    openStreamWithOptionalFallback,
    orderPinnedTabs,
    recoverWorkbenchTabs,
    type IncidentMarker,
  } from "$features/pods-workbench";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import DataTable from "./deployments-list/data-table.svelte";
  import DeploymentSelectionCheckbox from "./deployments-list/deployment-selection-checkbox.svelte";
  import DeploymentActionsMenu from "./deployments-list/deployment-actions-menu.svelte";
  import DeploymentBulkActions from "./deployments-list/deployment-bulk-actions.svelte";
  import DeploymentStatusBadge from "./deployments-list/deployment-status-badge.svelte";
  import {
    buildDeploymentLogsArgs,
    buildDeploymentPodFallbackLogsArgs,
  } from "./deployments-list/deployment-log-args";
  import {
    getDeploymentsWorkbenchStateKey,
    parseDeploymentsWorkbenchState,
    type PersistedDeploymentsWorkbenchState,
    type PersistedDeploymentsWorkbenchTab,
  } from "./deployments-list/workbench-session";
  import DetailsHeaderActions from "./common/details-header-actions.svelte";
  import WorkloadCommandOutputSheet from "./common/workload-command-output-sheet.svelte";
  import DetailsExplainState from "./common/details-explain-state.svelte";
  import ResourceTrafficChain from "./common/resource-traffic-chain.svelte";
  import DetailsEventsList from "./common/details-events-list.svelte";
  import WorkloadEventsSheet from "./common/workload-events-sheet.svelte";
  import { loadWorkloadEvents, type WorkloadEvent } from "./common/workload-events";
  import { buildRolloutCommandArgs, loadRolloutCommandOutput, type RolloutCommandMode } from "./common/workload-rollout";
  import ResourceLogsSheet from "./common/resource-logs-sheet.svelte";
  import ResourceYamlSheet from "./common/resource-yaml-sheet.svelte";
  import { buildYamlFilename } from "$features/pods-workbench";
  import { kubectlStreamArgsFront, type KubectlStreamProcess } from "$shared/api/kubectl-proxy";
  import { mapDeploymentRows } from "./deployments-list/model/map-deployment-rows";
  import { buildKubectlDescribeCommand } from "./common/kubectl-command-builder";
  import KeyValueExpand from "./common/key-value-expand.svelte";
  import { fetchNamespacedSnapshotItems } from "./common/namespaced-snapshot";
  import { createWorkloadWatcher } from "./common/workload-watcher";
  import { createDetailsActionManager } from "./common/details-action-manager";
  import { invalidateWorkloadSnapshotCache } from "./common/workload-cache-invalidation";
  import { createMutationReconcile } from "./common/workload-mutation-reconcile";
  import { normalizeDeploymentRolloutResolution } from "./deployments-list/deployment-rollout";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
    resolveCoreResourceSyncPolicy,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import ResourceSummaryStrip from "./common/resource-summary-strip.svelte";
  import SectionRuntimeStatus from "./common/section-runtime-status.svelte";
  import WorkloadSelectionBar from "./common/workload-selection-bar.svelte";
  import {
    confirmWorkbenchLayoutShrink,
    confirmWorkbenchTabClose,
  } from "./common/workbench-confirm";

  interface DeploymentsListProps {
    data: PageData & {
      deployments?: DeploymentItem[];
    };
  }

  type SelectedDeployment = (DeploymentItem & { uuid: string }) | null;
  type DeploymentsTableViewMode = "flat" | "namespace" | "node";
  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
    viewMode: DeploymentsTableViewMode;
  };
  type WorkbenchLayout = "single" | "dual" | "triple";
  type WorkbenchTab = {
    id: string;
    kind: "logs" | "yaml" | "events" | "rollout-status" | "rollout-history";
    title: string;
    subtitle: string;
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
    bookmarks: Array<{ id: string; line: number; label: string; createdAt: number }>;
  };
  type YamlTabState = {
    id: string;
    target: { name: string; namespace: string };
    yamlLoading: boolean;
    yamlSaving: boolean;
    yamlError: string | null;
    yamlText: string;
    yamlOriginalText: string;
    yamlDriftDetected: boolean;
    yamlDriftMessage: string | null;
    yamlDriftClusterYaml: string;
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
  type ClosedWorkbenchTab = {
    kind: "logs" | "yaml" | "events" | "rollout-status" | "rollout-history";
    target: { name: string; namespace: string } | null;
    pinned: boolean;
  };
  type DeploymentRow = {
    uid: string;
    name: string;
    namespace: string;
    ready: string;
    upToDate: number;
    available: number;
    node: string;
    replicas: number;
    age: string;
    ageSeconds: number;
    status: string;
    problemScore: number;
  };
  type DeploymentDetailPod = {
    name: string;
    node: string;
    podIp: string;
    namespace: string;
    ready: string;
    cpu: string;
    memory: string;
    status: string;
  };
  type DeploymentDetailEvent = {
    type: string;
    reason: string;
    message: string;
    lastTimestamp: string;
  };
  type DeploymentDetailRevision = {
    revision: number;
    pods: string;
    age: string;
  };

  const WATCHER_SETTINGS_PREFIX = "dashboard.deployments.watcher.settings.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 30,
    viewMode: "flat",
  };

  const { data }: DeploymentsListProps = $props();

  let selectedItem = $state<SelectedDeployment>(null);
  let isOpen = $state(false);
  let deploymentsSnapshot = $state<DeploymentItem[]>([]);
  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let watcherError = $state<string | null>(null);
  let deploymentsTableViewMode = $state<DeploymentsTableViewMode>(DEFAULT_WATCHER_SETTINGS.viewMode);
  let watcherInFlight = $state(false);
  let lastWatcherSuccessAt = $state<number | null>(null);
  let runtimeClockNow = $state(Date.now());
  let watcherSettingsLoadedCluster = $state<string | null>(null);
  let deploymentsSyncStarted = false;
  let deploymentsSyncStoreUnsubscribe: (() => void) | null = null;
  const watcherPolicy = $derived.by(() =>
    resolveCoreResourceSyncPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
      supportsStream: true,
    }),
  );
  const watcherEngine = createWorkloadWatcher({
    workloadName: "deployments",
    isEnabled: () => watcherPolicy.enabled,
    getRefreshSeconds: () => watcherPolicy.refreshSeconds,
    onTick: async () => {
      await refreshDeploymentsFromWatcher();
    },
  });
  const mutationReconcile = createMutationReconcile({
    isSyncEnabled: () => watcherPolicy.enabled,
    getSyncMode: () => watcherPolicy.mode,
    getClusterId: () => data?.slug ?? null,
    getScopeKey: () => "deployment",
    refresh: () => refreshDeploymentsFromWatcher(),
  });
  let detailsLoading = $state(false);
  let detailsError = $state<string | null>(null);
  let detailsPods = $state<DeploymentDetailPod[]>([]);
  let detailsEvents = $state<DeploymentDetailEvent[]>([]);
  let detailsRevisions = $state<DeploymentDetailRevision[]>([]);
  let detailsKeyLoaded = $state<string | null>(null);
  const detailsActions = createDetailsActionManager();
  let showPodAntiAffinitiesDetails = $state(false);
  let selectedDeploymentIds = $state(new Set<string>());
  import { notifySuccess, notifyError, type ActionNotification } from "$shared/lib/action-notification";
  let actionNotification = $state<ActionNotification>(null);
  
  let actionInFlight = $state(false);
  let workbenchOpen = writable(true);
  let logsOpen = writable(false);
  let logsTabs = $state<LogsTabState[]>([]);
  let logsJumpToLine = $state<number | null>(null);
  let incidentTimelineCursorId = $state<string | null>(null);
  let incidentTimelineDensity = $state<"all" | "warnings">("all");
  let yamlTabs = $state<YamlTabState[]>([]);
  let eventsTabs = $state<EventsTabState[]>([]);
  let rolloutTabs = $state<RolloutTabState[]>([]);
  let yamlDownloadError = $state<string | null>(null);
  let yamlDownloadMessage = $state<string | null>(null);
  let logsLiveTimers = new Map<string, ReturnType<typeof setInterval>>();
  let logsStreamProcesses = new Map<string, KubectlStreamProcess>();
  let logsStreamReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let logsStreamTokens = new Map<string, number>();
  let activeWorkbenchTabId = $state<string | null>(null);
  let workbenchFullscreen = $state(false);
  let workbenchCollapsed = $state(false);
  let workbenchLayout = $state<WorkbenchLayout>("single");
  let workbenchTabs = $state<WorkbenchTab[]>([]);
  let paneTabIds = $state<[string | null, string | null, string | null]>([null, null, null]);
  let collapsedPaneIndexes = $state<number[]>([]);
  let pinnedTabIds = $state(new Set<string>());
  let closedWorkbenchTabs = $state<ClosedWorkbenchTab[]>([]);
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);
  let pendingWorkbenchState = $state<PersistedDeploymentsWorkbenchState | null | undefined>(undefined);
  let workbenchStateRestored = $state(false);

  const logsLivePollMs = 2_000;
  const logsStreamReconnectMs = 1_200;
  const DEPLOYMENTS_ROWS_WORKER_THRESHOLD = 300;
  const ENABLE_DEPLOYMENTS_ROWS_WORKER = import.meta.env.VITE_ENABLE_DEPLOYMENTS_ROWS_WORKER !== "false";

  const orderedWorkbenchTabs = $derived.by(() => {
    return orderPinnedTabs(workbenchTabs, pinnedTabIds);
  });
  const hasWorkbenchTabs = $derived(orderedWorkbenchTabs.length > 0);
  const activeWorkbenchTab = $derived(
    orderedWorkbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );
  const activeLogsTab = $derived.by(() => {
    if (!activeWorkbenchTabId?.startsWith("logs:")) return null;
    return logsTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null;
  });
  const activeYamlTab = $derived.by(() => {
    if (!activeWorkbenchTabId?.startsWith("yaml:")) return null;
    return yamlTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null;
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

  const rowsSource = $derived(
    deploymentsSnapshot.filter((item) => namespaceMatches($selectedNamespace, item.metadata?.namespace)),
  );
  let deploymentsRowsWorker: Worker | null = null;
  let deploymentsRowsWorkerRequestId = 0;
  let deploymentsRowsWorkerResult = $state<DeploymentRow[] | null>(null);
  let deploymentsRowsWorkerFailures = 0;
  let deploymentsRowsWorkerDisabled = $state(false);
  const shouldUseDeploymentsRowsWorker = $derived(
    ENABLE_DEPLOYMENTS_ROWS_WORKER &&
      !deploymentsRowsWorkerDisabled &&
      rowsSource.length >= DEPLOYMENTS_ROWS_WORKER_THRESHOLD,
  );
  const inlineRows = $derived.by(() => {
    if (shouldUseDeploymentsRowsWorker && deploymentsRowsWorker) return [] as DeploymentRow[];
    return mapDeploymentRows(rowsSource) as DeploymentRow[];
  });
  const rows = $derived.by(() => {
    if (!shouldUseDeploymentsRowsWorker || !deploymentsRowsWorker) return inlineRows;
    return deploymentsRowsWorkerResult ?? [];
  });

  const columns: ColumnDef<DeploymentRow>[] = [
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
        return renderComponent(DeploymentSelectionCheckbox, {
          checked: allSelected,
          indeterminate: hasSomeSelected,
          label: "Select all deployments",
          onToggle: (next: boolean) => {
            toggleAllSelection(next);
          },
        });
      },
      cell: ({ row }) => {
        return renderComponent(DeploymentSelectionCheckbox, {
          checked: isDeploymentSelected(row.original.uid),
          label: `Select deployment ${row.original.name}`,
          onToggle: (next: boolean) => {
            toggleDeploymentSelection(row.original.uid, next);
          },
        });
      },
      enableSorting: false,
    },
    {
      id: "actions",
      header: () => {
        const actionsHeaderSnippet = createRawSnippet(() => ({
          render: () => `<div class="w-8"></div>`,
        }));
        return renderSnippet(actionsHeaderSnippet, {});
      },
      cell: ({ row }) => {
        const deployment =
          deploymentsSnapshot.find(
            (item) =>
              `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "-"}` === row.original.uid,
          ) ?? null;
        return renderComponent(DeploymentActionsMenu, {
          name: row.original.name,
          namespace: row.original.namespace,
          disabled: !deployment,
          isBusy: actionInFlight,
          onShowDetails: () => {
            if (deployment) openSheet(deployment);
          },
          onLogs: () => {
            if (deployment) void openLogsForDeployment(deployment);
          },
          onEvents: () => {
            if (deployment) void openEventsForDeployment(deployment);
          },
          onEditYaml: () => {
            if (deployment) void openYamlForDeployment(deployment);
          },
          onInvestigate: () => {
            if (deployment) void openDeploymentInvestigationWorkspace(deployment);
          },
          onCopyDescribe: () => {
            if (deployment) void copyDescribeCommandForDeployment(deployment);
          },
          onRunDebugDescribe: () => {
            if (deployment) openDebugDescribeForDeployment(deployment);
          },
          onRolloutStatus: () => {
            if (deployment) void openRolloutCommandForDeployment("status", deployment);
          },
          onRolloutHistory: () => {
            if (deployment) void openRolloutCommandForDeployment("history", deployment);
          },
          onDownloadYaml: () => {
            if (deployment) void downloadYamlForDeployments([deployment]);
          },
          onRestart: () => {
            if (deployment) void rolloutAction("restart", [deployment]);
          },
          onPause: () => {
            if (deployment) void rolloutAction("pause", [deployment]);
          },
          onResume: () => {
            if (deployment) void rolloutAction("resume", [deployment]);
          },
          onUndo: () => {
            if (deployment) void rolloutAction("undo", [deployment]);
          },
          onDelete: () => {
            if (deployment) void deleteDeployments([deployment]);
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
    {
      accessorKey: "namespace",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Namespace",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "ready", header: "Ready" },
    { accessorKey: "upToDate", header: "Up-to-date" },
    { accessorKey: "available", header: "Available" },
    {
      accessorKey: "node",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Node",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "replicas", header: "Replicas" },
    {
      accessorFn: (row) => row.ageSeconds,
      id: "age",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Age",
          onclick: column.getToggleSortingHandler(),
        }),
      cell: ({ row }) => row.original.age,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) =>
        renderComponent(DeploymentStatusBadge, {
          status: row.original.status,
        }),
    },
  ];

  const availableIds = $derived(rows.map((item) => item.uid).filter(Boolean));
  const allSelected = $derived(
    availableIds.length > 0 && availableIds.every((id) => selectedDeploymentIds.has(id)),
  );
  const hasSomeSelected = $derived(selectedDeploymentIds.size > 0 && !allSelected);

  function clampWatcherRefreshSeconds(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    return Math.min(600, Math.max(5, Math.round(value)));
  }

  function getWatcherSettingsKey(clusterId: string) {
    return `${WATCHER_SETTINGS_PREFIX}:${clusterId}`;
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

  function loadWorkbenchState(clusterId: string): PersistedDeploymentsWorkbenchState | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(getDeploymentsWorkbenchStateKey(clusterId));
      return parseDeploymentsWorkbenchState(raw);
    } catch {
      return null;
    }
  }

  function clearWorkbenchState(clusterId: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(getDeploymentsWorkbenchStateKey(clusterId));
    } catch {
      // Ignore localStorage failures.
    }
  }

  function persistWorkbenchState() {
    if (typeof window === "undefined") return;
    if (!data?.slug) return;
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
        } satisfies PersistedDeploymentsWorkbenchTab;
      })
      .filter((tab): tab is PersistedDeploymentsWorkbenchTab => Boolean(tab));

    const payload: PersistedDeploymentsWorkbenchState = {
      version: 1,
      tabs,
      activeTabId: activeWorkbenchTabId,
      layout: workbenchLayout,
      paneTabIds,
      collapsedPaneIndexes,
      closedTabs: closedWorkbenchTabs.map((entry) => ({
        kind: entry.kind,
        target: entry.target ? { ...entry.target } : null,
        pinned: entry.pinned,
      })),
      workbenchCollapsed,
      workbenchFullscreen,
    };

    try {
      window.localStorage.setItem(
        getDeploymentsWorkbenchStateKey(data.slug),
        JSON.stringify(payload),
      );
    } catch {
      // Ignore localStorage failures.
    }
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
          parsed.viewMode === "namespace" || parsed.viewMode === "flat" || parsed.viewMode === "node"
            ? parsed.viewMode
            : "namespace",
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
      viewMode: deploymentsTableViewMode,
    };
    try {
      window.localStorage.setItem(getWatcherSettingsKey(data.slug), JSON.stringify(payload));
    } catch {
      // Ignore localStorage failures.
    }
  }

  function openSheet(item: DeploymentItem) {
    selectedItem = { ...item, uuid: data.slug };
    isOpen = true;
    detailsKeyLoaded = null;
    showPodAntiAffinitiesDetails = false;
  }

  function openSheetByRow(row: DeploymentRow) {
    const deployment =
      deploymentsSnapshot.find(
        (item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "-"}` === row.uid,
      ) ?? null;
    if (deployment) openSheet(deployment);
  }

  function toggleDeploymentSelection(id: string, next?: boolean) {
    if (!id) return;
    const shouldSelect = typeof next === "boolean" ? next : !selectedDeploymentIds.has(id);
    const updated = new Set(selectedDeploymentIds);
    if (shouldSelect) updated.add(id);
    else updated.delete(id);
    selectedDeploymentIds = updated;
  }

  function isDeploymentSelected(id: string) {
    return selectedDeploymentIds.has(id);
  }

  function toggleAllSelection(next?: boolean) {
    if (availableIds.length === 0) {
      selectedDeploymentIds = new Set<string>();
      return;
    }
    const shouldSelectAll = typeof next === "boolean" ? next : availableIds.some((id) => !selectedDeploymentIds.has(id));
    selectedDeploymentIds = shouldSelectAll ? new Set(availableIds) : new Set<string>();
  }

  function toggleGroupSelection(_groupKey: string, next: boolean, rowIds: string[]) {
    const updated = new Set(selectedDeploymentIds);
    if (next) {
      rowIds.forEach((id) => updated.add(id));
    } else {
      rowIds.forEach((id) => updated.delete(id));
    }
    selectedDeploymentIds = updated;
  }

  function pruneSelectedDeployments(selected: Set<string>, available: string[]) {
    if (selected.size === 0) return selected;
    const availableSet = new Set(available);
    const next = new Set([...selected].filter((id) => availableSet.has(id)));
    if (next.size === selected.size) return selected;
    return next;
  }

  function getSelectedDeployments() {
    return deploymentsSnapshot.filter((item) => {
      const id = `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? "-"}`;
      return selectedDeploymentIds.has(id);
    });
  }

  function getSelectorQuery(item: DeploymentItem) {
    const labels = (item.spec?.selector?.matchLabels ?? {}) as Record<string, string>;
    return Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
  }

  function clearActionFeedback() {
    actionNotification = null;
  }

  function invalidateDeploymentsSnapshotCache() {
    invalidateWorkloadSnapshotCache(data?.slug, "deployments");
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

  async function copyDescribeCommandForDeployment(item: DeploymentItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    const command = buildKubectlDescribeCommand({
      resource: "deployments",
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

  function openDebugDescribeForDeployment(item: DeploymentItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    runDebugDescribe({
      clusterId: data.slug,
      resource: "deployment",
      name,
      namespace,
      title: `Describe deployment ${namespace}/${name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${namespace}/${name}.`);
    actionNotification = null;
  }

  async function getDeploymentPods(item: DeploymentItem) {
    if (!data?.slug) return [] as Array<{ name: string; containers: string[] }>;
    const namespace = item.metadata?.namespace ?? "default";
    const selectorQuery = getSelectorQuery(item);
    const response = await kubectlRawArgsFront(
      [
        "get",
        "pods",
        "--namespace",
        namespace,
        ...(selectorQuery ? ["-l", selectorQuery] : []),
        "-o",
        "json",
      ],
      { clusterId: data.slug },
    );
    if (response.errors || response.code !== 0) {
      throw new Error(response.errors || "Failed to resolve pods for deployment.");
    }
    const parsed = JSON.parse(response.output) as {
      items?: Array<{
        metadata?: { name?: string };
        spec?: { containers?: Array<{ name?: string }> };
      }>;
    };
    return (parsed.items ?? [])
      .map((pod) => ({
        name: pod.metadata?.name ?? "",
        containers: (pod.spec?.containers ?? [])
          .map((container) => container.name?.trim() ?? "")
          .filter(Boolean),
      }))
      .filter((pod) => Boolean(pod.name));
  }

  function getLogsTab(tabId: string | null) {
    if (!tabId) return null;
    return logsTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updateLogsTab(tabId: string, updater: (tab: LogsTabState) => LogsTabState) {
    let changed = false;
    logsTabs = logsTabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      changed = true;
      return updater(tab);
    });
    return changed;
  }

  function getYamlTab(tabId: string | null) {
    if (!tabId) return null;
    return yamlTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updateYamlTab(tabId: string, updater: (tab: YamlTabState) => YamlTabState) {
    let changed = false;
    yamlTabs = yamlTabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      changed = true;
      return updater(tab);
    });
    return changed;
  }

  function getEventsTab(tabId: string | null) {
    if (!tabId) return null;
    return eventsTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updateEventsTab(tabId: string, updater: (tab: EventsTabState) => EventsTabState) {
    let changed = false;
    eventsTabs = eventsTabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      changed = true;
      return updater(tab);
    });
    return changed;
  }

  function getRolloutTab(tabId: string | null) {
    if (!tabId) return null;
    return rolloutTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function updateRolloutTab(tabId: string, updater: (tab: RolloutTabState) => RolloutTabState) {
    let changed = false;
    rolloutTabs = rolloutTabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      changed = true;
      return updater(tab);
    });
    return changed;
  }

  async function loadLogsForTab(tabId: string) {
    if (!data?.slug) return;
    const tab = getLogsTab(tabId);
    if (!tab) return;
    const item = findDeploymentByTarget(tab.target);
    if (!item) {
      updateLogsTab(tabId, (current) => ({
        ...current,
        logsLoading: false,
        logsError: "Deployment not found.",
      }));
      return;
    }
    const namespace = item.metadata?.namespace ?? "default";
    updateLogsTab(tabId, (current) => ({ ...current, logsLoading: true, logsError: null }));
    const args = buildDeploymentLogsArgs(item, {
      follow: false,
      container: tab.logsSelectedContainer,
      previous: tab.logsPrevious,
    });
    if (!args) return;
    let response = await kubectlRawArgsFront(args, { clusterId: data.slug });
    if (response.errors || response.code !== 0) {
      const pods = await getDeploymentPods(item);
      const firstPod = pods[0]?.name;
      if (!firstPod) {
        throw new Error(response.errors || "No pods found for this deployment.");
      }
      const fallbackArgs = buildDeploymentPodFallbackLogsArgs(firstPod, namespace, {
        container: tab.logsSelectedContainer,
        previous: tab.logsPrevious,
      });
      response = await kubectlRawArgsFront(fallbackArgs, { clusterId: data.slug });
    }
    if (response.errors || response.code !== 0) {
      updateLogsTab(tabId, (current) => ({
        ...current,
        logsLoading: false,
        logsError: response.errors || "Failed to load deployment logs.",
        logsText: "",
      }));
      return;
    }
    const output = response.output || "";
    updateLogsTab(tabId, (current) => ({
      ...current,
      logsLoading: false,
      logsError: output.trim() ? null : "No logs available for this deployment yet.",
      logsText: output,
      logsUpdatedAt: Date.now(),
    }));
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
    if (timer) {
      clearInterval(timer);
      logsLiveTimers.delete(tabId);
    }
    void stopStreamForTab(tabId);
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

  function shouldKeepStreaming(tabId: string) {
    const tab = getLogsTab(tabId);
    return Boolean(tab && tab.logsLive && tab.logsMode === "stream-f");
  }

  function scheduleStreamReconnect(tabId: string) {
    clearStreamReconnect(tabId);
    if (!shouldKeepStreaming(tabId)) return;
    updateLogsTab(tabId, (current) => ({
      ...current,
      logsLoading: true,
      logsError: "Stream disconnected. Reconnecting...",
    }));
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
    const deployment = findDeploymentByTarget(tab.target);
    if (!deployment) return;

    const token = bumpStreamToken(tabId);
    await stopStreamForTab(tabId, false);
    updateLogsTab(tabId, (current) => ({ ...current, logsLoading: true, logsError: null }));
    const args = buildDeploymentLogsArgs(deployment, {
      follow: true,
      container: tab.logsSelectedContainer,
      previous: tab.logsPrevious,
    });
    if (!args) return;
    const namespace = deployment.metadata?.namespace ?? "default";
    const streamHandlers = {
      onStdoutData: (chunk: string) => {
        if (logsStreamTokens.get(tabId) !== token) return;
        if (!chunk) return;
        updateLogsTab(tabId, (current) => ({
          ...current,
          logsText: `${current.logsText}${chunk}`,
          logsUpdatedAt: Date.now(),
          logsLoading: false,
          logsError: null,
        }));
      },
      onStderrData: (chunk: string) => {
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
      onError: (error: unknown) => {
        if (logsStreamTokens.get(tabId) !== token) return;
        updateLogsTab(tabId, (current) => ({
          ...current,
          logsLoading: false,
          logsError: error instanceof Error ? error.message : String(error),
        }));
        scheduleStreamReconnect(tabId);
      },
    };

    const openStream = async (streamArgs: string[]) => {
      return await kubectlStreamArgsFront(streamArgs, { clusterId: data.slug }, streamHandlers);
    };

    try {
      const process = await openStreamWithOptionalFallback(
        async () => {
          const primaryProcess = await openStream(args);
          if (!primaryProcess) throw new Error("Unable to start deployment log stream.");
          return primaryProcess;
        },
        async () => {
          const pods = await getDeploymentPods(deployment);
          const firstPod = pods[0]?.name;
          if (!firstPod) throw new Error("Unable to start deployment log stream.");
          const fallbackArgs = buildDeploymentPodFallbackLogsArgs(firstPod, namespace, {
            follow: true,
            container: tab.logsSelectedContainer,
            previous: tab.logsPrevious,
          });
          return await openStream(fallbackArgs);
        },
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

  async function openLogsForDeployment(item: DeploymentItem) {
    if (!data?.slug) return;
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const nextTabId = `logs:${namespace}/${name}`;
    const existing = getLogsTab(nextTabId);
    if (!existing) {
      logsTabs = [
        ...logsTabs,
        {
          id: nextTabId,
          target: { name, namespace },
          logsText: "",
          logsError: null,
          logsLoading: false,
          logsLive: true,
          logsMode: "poll",
          logsUpdatedAt: null,
          logsPrevious: false,
          logsContainerOptions: ["__all__"],
          logsSelectedContainer: "__all__",
          bookmarks: [],
        },
      ];
    } else {
      updateLogsTab(nextTabId, (tab) => ({ ...tab, target: { name, namespace } }));
    }
    logsOpen.set(true);
    upsertWorkbenchTab({
      id: nextTabId,
      kind: "logs",
      title: `Logs ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    updateLogsTab(nextTabId, (tab) => ({
      ...tab,
      logsLoading: true,
      logsError: null,
      logsText: "",
      logsSelectedContainer: "__all__",
      logsContainerOptions: ["__all__"],
      logsPrevious: false,
      bookmarks: [],
    }));
    try {
      const pods = await getDeploymentPods(item);
      const containers = new Set<string>();
      for (const pod of pods) {
        for (const container of pod.containers) containers.add(container);
      }
      updateLogsTab(nextTabId, (tab) => ({
        ...tab,
        logsContainerOptions: ["__all__", ...containers],
      }));
      await loadLogsForTab(nextTabId);
      startLiveLogsForTab(nextTabId);
    } catch (error) {
      updateLogsTab(nextTabId, (tab) => ({
        ...tab,
        logsLoading: false,
        logsError: error instanceof Error ? error.message : "Failed to load deployment logs.",
      }));
    }
  }

  async function openYamlForDeployment(item: DeploymentItem) {
    if (!data?.slug) return;
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const nextTabId = `yaml:${namespace}/${name}`;
    const existing = getYamlTab(nextTabId);
    if (!existing) {
      yamlTabs = [
        ...yamlTabs,
        {
          id: nextTabId,
          target: { name, namespace },
          yamlLoading: true,
          yamlSaving: false,
          yamlError: null,
          yamlText: "",
          yamlOriginalText: "",
          yamlDriftDetected: false,
          yamlDriftMessage: null,
          yamlDriftClusterYaml: "",
        },
      ];
    } else {
      updateYamlTab(nextTabId, (tab) => ({
        ...tab,
        target: { name, namespace },
        yamlLoading: true,
        yamlError: null,
      }));
    }
    upsertWorkbenchTab({
      id: nextTabId,
      kind: "yaml",
      title: `YAML ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    try {
      const response = await kubectlRawArgsFront(
        ["get", "deployment", name, "--namespace", namespace, "-o", "yaml"],
        { clusterId: data.slug },
      );
      if (response.errors || response.code !== 0) {
        throw new Error(response.errors || "Failed to load deployment YAML.");
      }
      updateYamlTab(nextTabId, (tab) => ({
        ...tab,
        yamlLoading: false,
        yamlError: null,
        yamlText: response.output || "",
        yamlOriginalText: response.output || "",
        yamlDriftDetected: false,
        yamlDriftMessage: null,
        yamlDriftClusterYaml: "",
      }));
    } catch (error) {
      updateYamlTab(nextTabId, (tab) => ({
        ...tab,
        yamlLoading: false,
        yamlError: error instanceof Error ? error.message : "Failed to load deployment YAML.",
      }));
    }
  }

  async function openEventsForDeployment(item: DeploymentItem) {
    if (!data?.slug) return;
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const nextTabId = `events:${namespace}/${name}`;
    const existing = getEventsTab(nextTabId);
    if (!existing) {
      eventsTabs = [
        ...eventsTabs,
        {
          id: nextTabId,
          target: { name, namespace },
          events: [],
          eventsLoading: true,
          eventsError: null,
        },
      ];
    } else {
      updateEventsTab(nextTabId, (tab) => ({
        ...tab,
        target: { name, namespace },
        eventsLoading: true,
        eventsError: null,
      }));
    }
    upsertWorkbenchTab({
      id: nextTabId,
      kind: "events",
      title: `Events ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    try {
      const events = await loadWorkloadEvents(data.slug, {
        resource: "deployment",
        name,
        namespace,
      });
      updateEventsTab(nextTabId, (tab) => ({
        ...tab,
        events,
        eventsLoading: false,
        eventsError: null,
      }));
    } catch (error) {
      updateEventsTab(nextTabId, (tab) => ({
        ...tab,
        events: [],
        eventsLoading: false,
        eventsError: error instanceof Error ? error.message : "Failed to load deployment events.",
      }));
    }
  }

  async function openRolloutCommandForDeployment(mode: RolloutCommandMode, item: DeploymentItem) {
    if (!data?.slug) return;
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const tabKind = mode === "status" ? "rollout-status" : "rollout-history";
    const nextTabId = `${tabKind}:${namespace}/${name}`;
    const existing = getRolloutTab(nextTabId);
    if (!existing) {
      rolloutTabs = [
        ...rolloutTabs,
        {
          id: nextTabId,
          target: { name, namespace },
          mode,
          output: "",
          loading: true,
          error: null,
        },
      ];
    } else {
      updateRolloutTab(nextTabId, (tab) => ({
        ...tab,
        target: { name, namespace },
        mode,
        loading: true,
        error: null,
      }));
    }
    upsertWorkbenchTab({
      id: nextTabId,
      kind: tabKind,
      title: `${mode === "status" ? "Rollout status" : "Rollout history"} ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    try {
      const output = await loadRolloutCommandOutput(
        data.slug,
        mode,
        { resource: "deployment", name, namespace },
      );
      updateRolloutTab(nextTabId, (tab) => ({
        ...tab,
        output,
        loading: false,
        error: null,
      }));
    } catch (error) {
      updateRolloutTab(nextTabId, (tab) => ({
        ...tab,
        output: "",
        loading: false,
        error: error instanceof Error ? error.message : `Failed to load rollout ${mode}.`,
      }));
    }
  }

  async function openDeploymentInvestigationWorkspace(item: DeploymentItem) {
    if (!data?.slug) return;
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;
    const logsTabId = `logs:${namespace}/${name}`;
    const yamlTabId = `yaml:${namespace}/${name}`;
    await openLogsForDeployment(item);
    await openYamlForDeployment(item);
    setWorkbenchLayout("dual");
    assignTabToPane(0, logsTabId);
    assignTabToPane(1, yamlTabId);
    assignTabToPane(2, null);
    setActiveWorkbenchTab(logsTabId);
  }

  async function saveDeploymentYaml(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!data?.slug || !tab) return;
    if (!tab.yamlText.trim()) {
      updateYamlTab(tabId, (current) => ({ ...current, yamlError: "YAML is empty." }));
      return;
    }
    try {
      parseYaml(tab.yamlText);
    } catch (error) {
      if (error instanceof YAMLException) {
        const line = typeof error.mark?.line === "number" ? error.mark.line + 1 : null;
        updateYamlTab(tabId, (current) => ({
          ...current,
          yamlError: line ? `YAML syntax error at line ${line}: ${error.message}` : error.message,
        }));
      } else {
        updateYamlTab(tabId, (current) => ({
          ...current,
          yamlError: error instanceof Error ? error.message : "Invalid YAML syntax.",
        }));
      }
      return;
    }

    updateYamlTab(tabId, (current) => ({ ...current, yamlSaving: true, yamlError: null }));
    const relativePath = `tmp/deployment-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`;
    try {
      const current = getYamlTab(tabId);
      if (!current) return;
      const latest = await kubectlRawArgsFront(
        ["get", "deployment", current.target.name, "--namespace", current.target.namespace, "-o", "yaml"],
        { clusterId: data.slug },
      );
      if (latest.errors || latest.code !== 0) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlSaving: false,
          yamlError: latest.errors || "Failed to load current YAML from cluster.",
        }));
        return;
      }
      const fresh = getYamlTab(tabId);
      if (!fresh) return;
      const drift = checkYamlDrift(fresh.yamlOriginalText, latest.output || "");
      if (drift.hasDrift) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlSaving: false,
          yamlDriftDetected: true,
          yamlDriftMessage: buildDriftMessage(drift),
          yamlDriftClusterYaml: latest.output || "",
          yamlError: null,
        }));
        return;
      }

      await mkdir("tmp", { recursive: true, baseDir: BaseDirectory.AppData });
      await writeTextFile(relativePath, fresh.yamlText, { baseDir: BaseDirectory.AppData });
      const appDataPath = await path.appDataDir();
      const absolutePath = await path.join(appDataPath, relativePath);
      const response = await kubectlRawArgsFront(["apply", "-f", absolutePath], { clusterId: data.slug });
      if (response.errors || response.code !== 0) {
        updateYamlTab(tabId, (value) => ({
          ...value,
          yamlError: formatApplyErrorMessage(
          response.errors || "Failed to apply YAML.",
          `${value.target.namespace}/${value.target.name}`,
        ),
        }));
        return;
      }
      const applied = getYamlTab(tabId);
      if (applied) actionNotification = notifySuccess(`Applied YAML: ${applied.target.namespace}/${applied.target.name}`);
      invalidateDeploymentsSnapshotCache();
      mutationReconcile.schedule();
      updateYamlTab(tabId, (value) => ({
        ...value,
        yamlOriginalText: value.yamlText,
        yamlDriftDetected: false,
        yamlDriftMessage: null,
        yamlDriftClusterYaml: "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply YAML.";
      const normalized = message.toLowerCase();
      const desktopOnlyHint =
        normalized.includes("not available") ||
        normalized.includes("plugin") ||
        normalized.includes("tauri");
      updateYamlTab(tabId, (value) => ({
        ...value,
        yamlError: desktopOnlyHint
          ? "Apply YAML requires desktop runtime with file-system access."
          : message,
      }));
    } finally {
      updateYamlTab(tabId, (value) => ({ ...value, yamlSaving: false }));
      try {
        await remove(relativePath, { baseDir: BaseDirectory.AppData });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }

  function rebaseDeploymentYamlEdits(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!tab?.yamlDriftClusterYaml) return;
    updateYamlTab(tabId, (value) => ({
      ...value,
      yamlOriginalText: value.yamlDriftClusterYaml,
      yamlDriftDetected: false,
      yamlDriftMessage: null,
      yamlDriftClusterYaml: "",
      yamlError: null,
    }));
  }

  async function downloadYamlForDeployments(items: DeploymentItem[]) {
    if (!data?.slug || items.length === 0) return;
    yamlDownloadError = null;
    yamlDownloadMessage = null;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["get", "deployment", name, "--namespace", namespace, "-o", "yaml"],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to download YAML for ${namespace}/${name}.`);
        }
        const filename = buildYamlFilename("deployment", namespace, name);
        await writeTextFile(filename, response.output || "", { baseDir: BaseDirectory.Download });
      }
      if (items.length === 1) {
        const only = items[0];
        const onlyName = only.metadata?.name ?? "deployment";
        const onlyNs = only.metadata?.namespace ?? "default";
        yamlDownloadMessage = `YAML exported ~/Downloads: ${buildYamlFilename("deployment", onlyNs, onlyName)}`;
      } else {
        yamlDownloadMessage = `YAML exported ~/Downloads: ${items.length} files.`;
      }
    } catch (error) {
      yamlDownloadError = error instanceof Error ? error.message : "Failed to download YAML.";
    } finally {
      actionInFlight = false;
    }
  }

  async function rolloutAction(action: "restart" | "pause" | "resume" | "undo", items: DeploymentItem[]) {
    if (!data?.slug || items.length === 0) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      let noopCount = 0;
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const targetRef = `${namespace}/${name}`;
        const response = await kubectlRawArgsFront(
          ["rollout", action, `deployment/${name}`, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          const resolution = normalizeDeploymentRolloutResolution(
            action,
            targetRef,
            response.errors || `Failed to ${action} ${targetRef}.`,
          );
          if (resolution.kind === "noop") {
            noopCount += 1;
            continue;
          }
          throw new Error(resolution.message);
        }
      }
      const executedCount = items.length - noopCount;
      if (executedCount > 0) {
        actionNotification = notifySuccess(`Rollout ${action} executed for ${executedCount} deployment${executedCount === 1 ? "" : "s"}.`);
        if (noopCount > 0) {
          actionNotification = notifySuccess(`Rollout ${action} executed for ${executedCount} deployment${executedCount === 1 ? "" : "s"}. ${noopCount} deployment${noopCount === 1 ? "" : "s"} already matched the requested state.`);
        }
      } else if (noopCount > 0) {
        actionNotification = notifySuccess(`All selected deployments already matched the requested rollout state.`);
      }
      invalidateDeploymentsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : `Failed to ${action} deployment rollout.`);
    } finally {
      actionInFlight = false;
    }
  }

  async function deleteDeployments(items: DeploymentItem[]) {
    if (!data?.slug || items.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${items.length} deployment${items.length === 1 ? "" : "s"}? This cannot be undone.`,
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
          ["delete", "deployment", name, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to delete ${namespace}/${name}.`);
        }
      }
      selectedDeploymentIds = new Set<string>();
      removeDeploymentsFromSnapshot(items);
      actionNotification = notifySuccess(`Deleted ${items.length} deployment${items.length === 1 ? "" : "s"}.`);
      invalidateDeploymentsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["DELETED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to delete deployments.");
    } finally {
      actionInFlight = false;
    }
  }

  function findDeploymentByTarget(target: { name: string; namespace: string } | null) {
    if (!target) return null;
    return (
      deploymentsSnapshot.find(
        (item) =>
          item.metadata?.name === target.name &&
          (item.metadata?.namespace ?? "default") === target.namespace,
      ) ?? null
    );
  }

  function buildPersistedDeploymentStub(name: string, namespace: string): DeploymentItem {
    return {
      metadata: {
        name,
        namespace,
        uid: `${namespace}/${name}`,
      },
      spec: {
        selector: {
          matchLabels: {},
        },
      },
      status: {},
    } as unknown as DeploymentItem;
  }

  function refreshYamlForTab(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!tab) return;
    const deployment = findDeploymentByTarget(tab.target);
    if (deployment) void openYamlForDeployment(deployment);
  }

  function stopWatcherTimer() {
    watcherEngine.stop();
  }

  function startWatcherTimer() {
    watcherEngine.start();
  }

  function bindDeploymentsSyncStore(clusterId: string) {
    deploymentsSyncStoreUnsubscribe?.();
    deploymentsSyncStoreUnsubscribe = selectClusterDeployments(clusterId).subscribe((items) => {
      deploymentsSnapshot = items as DeploymentItem[];
      lastWatcherSuccessAt = Date.now();
    });
  }

  async function refreshDeploymentsFromWatcher(source: "manual" | "watcher" = "watcher") {
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
    markDeploymentsSyncLoading(data.slug);
    try {
      deploymentsSnapshot = await fetchNamespacedSnapshotItems<DeploymentItem>({
        clusterId: data.slug,
        selectedNamespace: $selectedNamespace,
        resource: "deployments",
        errorMessage: "Deployment watcher sync failed.",
      });
      lastWatcherSuccessAt = Date.now();
      markDeploymentsSyncSuccess(data.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deployment watcher sync failed.";
      watcherError = message;
      markDeploymentsSyncError(data.slug, message);
    } finally {
      watcherInFlight = false;
    }
  }

  function applyWatcherMode() {
    if (!data?.slug) return;
    if (watcherPolicy.enabled) {
      setDeploymentsSyncEnabled(data.slug, true);
      if (watcherPolicy.mode === "stream") {
        stopWatcherTimer();
        bindDeploymentsSyncStore(data.slug);
        initDeploymentsSync(data.slug, Array.isArray(data.deployments) ? data.deployments : []);
        deploymentsSyncStarted = true;
      } else {
        if (deploymentsSyncStarted) {
          destroyDeploymentsSync(data.slug);
          deploymentsSyncStarted = false;
        }
        startWatcherTimer();
      }
      void refreshDeploymentsFromWatcher();
      return;
    }
    setDeploymentsSyncEnabled(data.slug, false);
    stopWatcherTimer();
    if (deploymentsSyncStarted) {
      destroyDeploymentsSync(data.slug);
      deploymentsSyncStarted = false;
    }
  }

  const watcherStaleThresholdMs = $derived(watcherPolicy.refreshSeconds * 2000);
  const watcherFreshnessAgeMs = $derived(
    lastWatcherSuccessAt ? Date.now() - lastWatcherSuccessAt : Number.POSITIVE_INFINITY,
  );
  const watcherIsStale = $derived(
    watcherPolicy.enabled && Number.isFinite(watcherFreshnessAgeMs) && watcherFreshnessAgeMs > watcherStaleThresholdMs,
  );
  const deploymentsRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const deploymentsRuntimeSourceState = $derived.by(() => {
    if (!watcherPolicy.enabled) return "paused";
    if (watcherError && deploymentsSnapshot.length > 0) return "cached";
    if (watcherError) return "error";
    if (watcherIsStale) return "stale";
    if (watcherInFlight && deploymentsSnapshot.length > 0) return "cached";
    if (lastWatcherSuccessAt) return "live";
    if (deploymentsSnapshot.length > 0) return "cached";
    return "idle";
  });
  const deploymentsRuntimeLastUpdatedLabel = $derived.by(() => {
    void runtimeClockNow;
    if (!lastWatcherSuccessAt) return null;
    return `updated ${getTimeDifference(new Date(lastWatcherSuccessAt))} ago`;
  });
  const deploymentsRuntimeDetail = $derived.by(() => {
    if (!watcherPolicy.enabled) return "Deployment sync is paused until you refresh or re-enable the watcher.";
    if (watcherError && deploymentsSnapshot.length > 0) {
      return "Showing the last successful deployment snapshot while background refresh is degraded.";
    }
    if (watcherError) return "Deployment sync is degraded and needs operator attention.";
    if (watcherIsStale) return "Deployment data has exceeded the freshness budget and should be refreshed.";
    if (watcherInFlight) return "Background deployment refresh is currently in flight.";
    return "Deployment sync is operating within the current runtime budget.";
  });
  const deploymentsRuntimeReason = $derived.by(() => {
    if (watcherError) return watcherError;
    return watcherPolicy.mode === "stream"
      ? "Streaming watcher active for deployments."
      : `Polling deployments every ${watcherPolicy.refreshSeconds}s.`;
  });
  const deploymentsNamespaceSummary = $derived($selectedNamespace || "all");
  const deploymentsSummaryView = $derived(
    deploymentsTableViewMode === "namespace"
      ? "By namespace"
      : deploymentsTableViewMode === "node"
        ? "By node"
        : "Flat",
  );

  function removeDeploymentsFromSnapshot(items: DeploymentItem[]) {
    const keys = new Set(
      items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
    );
    if (watcherPolicy.mode === "stream" && data?.slug) {
      for (const item of items) {
        applyDeploymentEvent(data.slug, { type: "DELETED", object: item });
      }
      return;
    }
    deploymentsSnapshot = deploymentsSnapshot.filter((item) => {
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

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    deploymentsTableViewMode = DEFAULT_WATCHER_SETTINGS.viewMode;
    persistWatcherSettings();
    applyWatcherMode();
  }

  function closeDetails() {
    isOpen = false;
  }

  async function runDetailsAction(action: () => void | Promise<void>) {
    closeDetails();
    await tick();
    await action();
  }

  function setActiveWorkbenchTab(tabId: string) {
    activeWorkbenchTabId = tabId;
    workbenchCollapsed = false;
  }

  function upsertWorkbenchTab(tab: WorkbenchTab) {
    const existing = workbenchTabs.find((item) => item.id === tab.id);
    if (existing) {
      workbenchTabs = workbenchTabs.map((item) => (item.id === tab.id ? tab : item));
      setActiveWorkbenchTab(tab.id);
      return;
    }
    workbenchTabs = [...workbenchTabs, tab];
    setActiveWorkbenchTab(tab.id);
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

  function getPaneCount() {
    if (workbenchLayout === "single") return 1;
    if (workbenchLayout === "dual") return 2;
    return 3;
  }

  function setPaneTabIdsIfChanged(next: [string | null, string | null, string | null]) {
    if (
      next[0] === paneTabIds[0] &&
      next[1] === paneTabIds[1] &&
      next[2] === paneTabIds[2]
    ) {
      return;
    }
    paneTabIds = next;
  }

  function setCollapsedPaneIndexesIfChanged(next: number[]) {
    if (next.length === collapsedPaneIndexes.length) {
      let same = true;
      for (let idx = 0; idx < next.length; idx += 1) {
        if (next[idx] !== collapsedPaneIndexes[idx]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    collapsedPaneIndexes = next;
  }

  function setWorkbenchLayout(layout: WorkbenchLayout) {
    if (workbenchLayout !== layout) {
      workbenchLayout = layout;
    }
    if (layout === "single") {
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    const ids = orderedWorkbenchTabs.map((tab) => tab.id);
    const used = new Set<string>();
    const next: [string | null, string | null, string | null] = [...paneTabIds] as [
      string | null,
      string | null,
      string | null,
    ];
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
    if (layout === "dual" && yamlComparePair) {
      const [leftId, rightId] = yamlComparePair;
      if (!next.includes(leftId) || !next.includes(rightId)) {
        yamlComparePair = null;
        yamlCompareTargetTabId = null;
      }
    }
  }

  function normalizePaneTabIdsForCurrentLayout() {
    if (workbenchLayout === "single") return;
    const ids = orderedWorkbenchTabs.map((tab) => tab.id);
    const used = new Set<string>();
    const next: [string | null, string | null, string | null] = [...paneTabIds] as [
      string | null,
      string | null,
      string | null,
    ];
    for (let idx = 0; idx < 3; idx += 1) {
      if (next[idx] && !ids.includes(next[idx] as string)) next[idx] = null;
      if (next[idx]) used.add(next[idx] as string);
    }
    if (!next[0] && activeWorkbenchTabId && ids.includes(activeWorkbenchTabId)) {
      next[0] = activeWorkbenchTabId;
      used.add(activeWorkbenchTabId);
    }
    for (let idx = 1; idx < (workbenchLayout === "dual" ? 2 : 3); idx += 1) {
      if (next[idx]) continue;
      const candidate = ids.find((id) => !used.has(id)) ?? null;
      next[idx] = candidate;
      if (candidate) used.add(candidate);
    }
    if (workbenchLayout === "dual") next[2] = null;
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

    const { occupiedRemovedPaneCount, tabsToClose } = computeLayoutClosePlan(
      paneTabIds,
      nextPaneCount,
    );

    if (occupiedRemovedPaneCount === 0) {
      setWorkbenchLayout(nextLayout);
      return;
    }

    const removedPaneItems = paneTabIds
      .map((tabId, index) => ({ tabId, index }))
      .filter((item) => item.index >= nextPaneCount && Boolean(item.tabId));
    const removedPaneDetails = removedPaneItems
      .map((item) => {
        const tab = item.tabId ? getWorkbenchTab(item.tabId) : null;
        const tabLabel = tab ? `${tab.title} (${tab.subtitle})` : item.tabId;
        return `Pane ${item.index + 1}: ${tabLabel}`;
      })
      .join("\n");

    const promptDetails =
      tabsToClose.length > 0
        ? `This will close ${tabsToClose.length} tab(s) from hidden panes:\n${removedPaneDetails}\n\nContinue?`
        : "This will hide occupied panes. Continue?";
    const confirmed = await confirmWorkbenchLayoutShrink(promptDetails);
    if (!confirmed) return;

    for (const tabId of tabsToClose) {
      await closeWorkbenchTab(tabId, { skipConfirm: true });
    }
    setWorkbenchLayout(nextLayout);
  }

  function assignTabToPane(paneIndex: 0 | 1 | 2, tabId: string | null) {
    const next: [string | null, string | null, string | null] = [...paneTabIds] as [
      string | null,
      string | null,
      string | null,
    ];
    next[paneIndex] = tabId;
    if (workbenchLayout === "dual") next[2] = null;
    setPaneTabIdsIfChanged(next);
    if (tabId) activeWorkbenchTabId = tabId;
    if (!tabId) {
      setCollapsedPaneIndexesIfChanged(collapsedPaneIndexes.filter((idx) => idx !== paneIndex));
    }
  }

  function getWorkbenchTab(tabId: string | null) {
    if (!tabId) return null;
    return orderedWorkbenchTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function isPaneCollapsed(paneIndex: number) {
    return collapsedPaneIndexes.includes(paneIndex);
  }

  function canCollapsePane(paneIndex: number) {
    if (getPaneCount() <= 1) return false;
    const tabId = paneTabIds[paneIndex];
    if (!tabId || !getWorkbenchTab(tabId)) return false;
    return true;
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

  function isTabPinned(tabId: string) {
    return pinnedTabIds.has(tabId);
  }

  function togglePinTab(tabId: string) {
    const next = new Set(pinnedTabIds);
    if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    pinnedTabIds = next;
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
          !(
            entry.kind === tab.kind &&
            entry.target?.name === target?.name &&
            entry.target?.namespace === target?.namespace
          ),
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
    if (yamlCompareSourceTabId === tabId) yamlCompareSourceTabId = null;
    if (yamlComparePair && (yamlComparePair[0] === tabId || yamlComparePair[1] === tabId)) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
    if (tabId.startsWith("logs:")) {
      logsTabs = logsTabs.filter((tab) => tab.id !== tabId);
      stopLiveLogsForTab(tabId);
      logsOpen.set(logsTabs.length > 0);
    } else if (tabId.startsWith("yaml:")) {
      yamlTabs = yamlTabs.filter((tab) => tab.id !== tabId);
    } else if (tabId.startsWith("events:")) {
      eventsTabs = eventsTabs.filter((tab) => tab.id !== tabId);
    } else if (tabId.startsWith("rollout-status:") || tabId.startsWith("rollout-history:")) {
      rolloutTabs = rolloutTabs.filter((tab) => tab.id !== tabId);
    }
    const nextPaneTabIds = paneTabIds.map((id) => (id === tabId ? null : id)) as [
      string | null,
      string | null,
      string | null,
    ];
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
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    const nextTab = remaining[index] ?? remaining[index - 1] ?? null;
    activeWorkbenchTabId = nextTab?.id ?? null;
  }

  function reopenLastClosedTab() {
    const entry = closedWorkbenchTabs[0];
    if (!entry) return;
    closedWorkbenchTabs = closedWorkbenchTabs.slice(1);
    if (!entry.target) return;
    const deployment =
      deploymentsSnapshot.find(
        (item) =>
          item.metadata?.name === entry.target?.name &&
          (item.metadata?.namespace ?? "default") === entry.target?.namespace,
      ) ?? null;
    if (!deployment) return;
    if (entry.kind === "logs") {
      void openLogsForDeployment(deployment);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `logs:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    if (entry.kind === "events") {
      void openEventsForDeployment(deployment);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `events:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    if (entry.kind === "rollout-status" || entry.kind === "rollout-history") {
      void openRolloutCommandForDeployment(entry.kind === "rollout-status" ? "status" : "history", deployment);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `${entry.kind}:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    void openYamlForDeployment(deployment);
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

  function getPaneIndexes() {
    const paneCount = getPaneCount();
    return Array.from({ length: paneCount }, (_, idx) => idx as 0 | 1 | 2);
  }

  function getPaneTab(index: number) {
    return getWorkbenchTab(paneTabIds[index]);
  }

  function getPaneLabel(index: number) {
    return `Pane ${index + 1}`;
  }

  function getPaneWrapperClass(index: number) {
    if (isPaneCollapsed(index)) {
      return "w-11 flex-none";
    }
    return "min-w-0 flex-1";
  }

  function toActiveDetailsKey() {
    if (!selectedItem) return null;
    return `${selectedItem.metadata?.namespace ?? "default"}/${selectedItem.metadata?.name ?? "-"}`;
  }

  function formatCreatedLabel() {
    const created = selectedItem?.metadata?.creationTimestamp;
    if (!created) return "-";
    const createdAt = new Date(created);
    return `${getTimeDifference(created)} ago (${createdAt.toLocaleString()})`;
  }

  function getLabelEntries() {
    return Object.entries(
      ((selectedItem?.metadata?.labels ?? {}) as Record<string, string>) ?? {},
    );
  }

  function getAnnotationEntries() {
    return Object.entries(
      ((selectedItem?.metadata?.annotations ?? {}) as Record<string, string>) ?? {},
    );
  }

  function getSelectorLabel() {
    const selector = (selectedItem?.spec?.selector?.matchLabels ?? {}) as Record<string, string>;
    const entries = Object.entries(selector);
    if (entries.length === 0) return "-";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
  }

  function getNodeSelectorLabel() {
    const templateSpec = selectedItem?.spec?.template?.spec as
      | { nodeSelector?: Record<string, string> }
      | undefined;
    const selector = (templateSpec?.nodeSelector ?? {}) as Record<string, string>;
    const entries = Object.entries(selector);
    if (entries.length === 0) return "-";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
  }

  function getReplicasLabel() {
    if (!selectedItem) return "-";
    const desired = selectedItem.spec?.replicas ?? 0;
    const updated = selectedItem.status?.replicas ?? 0;
    const total = selectedItem.status?.replicas ?? 0;
    const available = selectedItem.status?.availableReplicas ?? 0;
    const unavailable = Math.max(0, desired - available);
    return `${desired} desired, ${updated} updated, ${total} total, ${available} available, ${unavailable} unavailable`;
  }

  function getConditionsLabel() {
    const conditions = selectedItem?.status?.conditions ?? [];
    if (conditions.length === 0) return "-";
    return conditions.map((item) => item.type).join(" ");
  }

  function getConditionTypes() {
    const conditions = selectedItem?.status?.conditions ?? [];
    return conditions
      .map((item) => item.type?.trim())
      .filter((value): value is string => Boolean(value));
  }

  function getPodAntiAffinityRulesCount() {
    const templateSpec = selectedItem?.spec?.template?.spec as
      | {
          affinity?: {
            podAntiAffinity?: {
              requiredDuringSchedulingIgnoredDuringExecution?: unknown[];
              preferredDuringSchedulingIgnoredDuringExecution?: unknown[];
            };
          };
        }
      | undefined;
    const antiAffinity = templateSpec?.affinity?.podAntiAffinity as
      | {
          requiredDuringSchedulingIgnoredDuringExecution?: unknown[];
          preferredDuringSchedulingIgnoredDuringExecution?: unknown[];
        }
      | undefined;
    const required = antiAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.length ?? 0;
    const preferred = antiAffinity?.preferredDuringSchedulingIgnoredDuringExecution?.length ?? 0;
    return required + preferred;
  }

  function getPodAntiAffinityDetails() {
    const templateSpec = selectedItem?.spec?.template?.spec as
      | {
          affinity?: {
            podAntiAffinity?: {
              requiredDuringSchedulingIgnoredDuringExecution?: Array<{
                labelSelector?: { matchLabels?: Record<string, string> };
                topologyKey?: string;
              }>;
              preferredDuringSchedulingIgnoredDuringExecution?: Array<{
                weight?: number;
                podAffinityTerm?: {
                  labelSelector?: { matchLabels?: Record<string, string> };
                  topologyKey?: string;
                };
              }>;
            };
          };
        }
      | undefined;
    const antiAffinity = templateSpec?.affinity?.podAntiAffinity;
    const lines: string[] = [];
    for (const item of antiAffinity?.requiredDuringSchedulingIgnoredDuringExecution ?? []) {
      const labels = Object.entries(item.labelSelector?.matchLabels ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      lines.push(
        `required: topologyKey=${item.topologyKey ?? "-"}${labels ? `, labels: ${labels}` : ""}`,
      );
    }
    for (const item of antiAffinity?.preferredDuringSchedulingIgnoredDuringExecution ?? []) {
      const labels = Object.entries(item.podAffinityTerm?.labelSelector?.matchLabels ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ");
      lines.push(
        `preferred: weight=${item.weight ?? 0}, topologyKey=${item.podAffinityTerm?.topologyKey ?? "-"}${labels ? `, labels: ${labels}` : ""}`,
      );
    }
    return lines;
  }

  function getStatusTone(status: string) {
    if (status.includes("Running")) return "text-emerald-700 dark:text-emerald-400";
    if (status.includes("Failed")) return "text-red-700 dark:text-red-400";
    return "text-amber-700 dark:text-amber-400";
  }

  function getStatusToneClasses(status: string) {
    const tone = getStatusTone(status);
    if (tone.includes("emerald")) {
      return { dot: "bg-emerald-500", text: tone };
    }
    if (tone.includes("red")) {
      return { dot: "bg-red-500", text: tone };
    }
    return { dot: "bg-amber-500", text: tone };
  }

  function getPodStatusTone(status: string) {
    const lower = status.toLowerCase();
    if (lower.includes("running")) return "text-emerald-700 dark:text-emerald-400";
    if (lower.includes("pending")) return "text-amber-700 dark:text-amber-400";
    if (lower.includes("error") || lower.includes("failed") || lower.includes("crash")) {
      return "text-red-700 dark:text-red-400";
    }
    return "text-muted-foreground";
  }

  function getPodStatusToneClasses(status: string) {
    const tone = getPodStatusTone(status);
    if (tone.includes("emerald")) {
      return { dot: "bg-emerald-500", text: tone };
    }
    if (tone.includes("red")) {
      return { dot: "bg-red-500", text: tone };
    }
    if (tone.includes("amber")) {
      return { dot: "bg-amber-500", text: tone };
    }
    return { dot: "bg-slate-400", text: tone };
  }

  function getDetailsHeaderNode() {
    if (detailsPods.length > 0 && detailsPods[0]?.node) return detailsPods[0].node;
    const templateSpec = selectedItem?.spec?.template?.spec as
      | { nodeName?: string; nodeSelector?: Record<string, string> }
      | undefined;
    const nodeSelector = Object.entries(templateSpec?.nodeSelector ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    return templateSpec?.nodeName || nodeSelector || "-";
  }

  function getDetailsHeaderPodIp() {
    const firstPodIp = detailsPods.find((pod) => pod.podIp && pod.podIp !== "-")?.podIp;
    return firstPodIp ?? "-";
  }

  function getDeploymentDescribeCommand() {
    const name = selectedItem?.metadata?.name;
    if (!name) return null;
    return buildKubectlDescribeCommand({
      resource: "deployment",
      name,
      namespace: selectedItem?.metadata?.namespace,
    });
  }

  async function loadDetailsData() {
    if (!data?.slug || !selectedItem) return;
    const currentSelected = selectedItem;
    const name = currentSelected.metadata?.name;
    const namespace = currentSelected.metadata?.namespace ?? "default";
    if (!name) return;
    await detailsActions.runLatest("details", async ({ signal, isLatest }) => {
      detailsLoading = true;
      detailsError = null;
      try {
      const selector = (currentSelected.spec?.selector?.matchLabels ?? {}) as Record<string, string>;
      const selectorQuery = Object.entries(selector)
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

      const podsArgs = selectorQuery
        ? ["get", "pods", "--namespace", namespace, "-l", selectorQuery, "-o", "json"]
        : ["get", "pods", "--namespace", namespace, "-o", "json"];

      const [podsResponse, topResponse, eventsResponse, rsResponse] = await Promise.all([
        kubectlRawArgsFront(podsArgs, { clusterId: data.slug, signal }),
        kubectlRawArgsFront(
          [
            "top",
            "pods",
            "--namespace",
            namespace,
            ...(selectorQuery ? ["-l", selectorQuery] : []),
            "--no-headers",
          ],
          { clusterId: data.slug, signal },
        ),
        kubectlRawArgsFront(
          [
            "get",
            "events",
            "--namespace",
            namespace,
            "--field-selector",
            `involvedObject.kind=Deployment,involvedObject.name=${name}`,
            "--sort-by=.lastTimestamp",
            "-o",
            "json",
          ],
          { clusterId: data.slug, signal },
        ),
        kubectlRawArgsFront(["get", "rs", "--namespace", namespace, "-o", "json"], {
          clusterId: data.slug,
          signal,
        }),
      ]);

      if (!isLatest()) return;

      if (podsResponse.errors || podsResponse.code !== 0) {
        throw new Error(podsResponse.errors || "Failed to load deployment pods.");
      }

      const topByPod = new Map<string, { cpu: string; memory: string }>();
      for (const line of (topResponse.output || "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [podName, cpu, memory] = trimmed.split(/\s+/);
        if (podName) topByPod.set(podName, { cpu: cpu || "-", memory: memory || "-" });
      }

      const parsedPods = JSON.parse(podsResponse.output) as {
        items?: Array<{
          metadata?: { name?: string; namespace?: string };
          spec?: { nodeName?: string };
          status?: { phase?: string; containerStatuses?: Array<{ ready?: boolean }> };
        }>;
      };
      detailsPods = (parsedPods.items ?? []).map((item) => {
        const statuses = item.status?.containerStatuses ?? [];
        const ready = statuses.filter((status) => status.ready).length;
        const total = statuses.length;
        const podName = item.metadata?.name ?? "-";
        const top = topByPod.get(podName);
        return {
          name: podName,
          node: item.spec?.nodeName ?? "-",
          podIp: (item.status as { podIP?: string } | undefined)?.podIP ?? "-",
          namespace: item.metadata?.namespace ?? namespace,
          ready: `${ready} / ${total}`,
          cpu: top?.cpu ?? "-",
          memory: top?.memory ?? "-",
          status: item.status?.phase ?? "Unknown",
        };
      });

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
        detailsEvents = (parsedEvents.items ?? []).map((item) => ({
          type: item.type ?? "-",
          reason: item.reason ?? "-",
          message: item.message ?? "-",
          lastTimestamp: item.lastTimestamp || item.eventTime || item.firstTimestamp || "-",
        }));
      } else {
        detailsEvents = [];
      }

      if (!rsResponse.errors && rsResponse.code === 0 && rsResponse.output) {
        const parsedRs = JSON.parse(rsResponse.output) as {
          items?: Array<{
            metadata?: {
              creationTimestamp?: string;
              annotations?: Record<string, string>;
              ownerReferences?: Array<{ kind?: string; name?: string }>;
            };
            status?: { readyReplicas?: number; replicas?: number };
          }>;
        };
        detailsRevisions = (parsedRs.items ?? [])
          .filter((item) =>
            (item.metadata?.ownerReferences ?? []).some(
              (owner) => owner.kind === "Deployment" && owner.name === name,
            ),
          )
          .map((item) => ({
            revision: Number(item.metadata?.annotations?.["deployment.kubernetes.io/revision"] ?? "0"),
            pods: `${item.status?.readyReplicas ?? 0}/${item.status?.replicas ?? 0}`,
            age: getTimeDifference(item.metadata?.creationTimestamp as unknown as Date),
          }))
          .sort((a, b) => b.revision - a.revision);
      } else {
        detailsRevisions = [];
      }

      detailsKeyLoaded = `${namespace}/${name}`;
      } catch (error) {
        if (!isLatest()) return;
        detailsError = error instanceof Error ? error.message : "Failed to load deployment details.";
        detailsPods = [];
        detailsEvents = [];
        detailsRevisions = [];
      } finally {
        if (isLatest()) detailsLoading = false;
      }
    });
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if ($logsOpen) {
      logsOpen.set(false);
      return;
    }
    if (activeWorkbenchTabId) {
      void closeWorkbenchTab(activeWorkbenchTabId);
      return;
    }
    if (isOpen) {
      closeDetails();
    }
  }

  function jumpToIncidentMarker(marker: IncidentMarker) {
    incidentTimelineCursorId = marker.id;
    logsJumpToLine = typeof marker.line === "number" ? marker.line : null;
  }

  $effect(() => {
    if (!data?.slug) return;
    setInitialDeployments(data.slug, data.deployments ?? []);
    if (watcherPolicy.mode !== "stream") {
      deploymentsSnapshot = data.deployments ?? [];
    }
  });

  $effect(() => {
    const clusterId = data?.slug ?? null;
    if (!clusterId) return;
    if (watcherSettingsLoadedCluster === clusterId) return;

    const previousClusterId = watcherSettingsLoadedCluster;
    if (previousClusterId) {
      setDeploymentsSyncEnabled(previousClusterId, false);
      resetDeploymentsSyncStatus(previousClusterId);
      if (deploymentsSyncStarted) {
        destroyDeploymentsSync(previousClusterId);
        deploymentsSyncStarted = false;
      }
      deploymentsSyncStoreUnsubscribe?.();
      deploymentsSyncStoreUnsubscribe = null;
    }

    const settings = loadWatcherSettings(clusterId);
    watcherEnabled = settings.enabled;
    watcherRefreshSeconds = settings.refreshSeconds;
    deploymentsTableViewMode = settings.viewMode;
    watcherSettingsLoadedCluster = clusterId;
    applyWatcherMode();
  });

  function startDeploymentsRowsWorker() {
    if (typeof window === "undefined") return;
    if (typeof Worker === "undefined") return;
    if (!ENABLE_DEPLOYMENTS_ROWS_WORKER) return;
    if (deploymentsRowsWorkerDisabled) return;
    if (deploymentsRowsWorker) return;
    deploymentsRowsWorker = new Worker(new URL("./model/deployments-rows.worker.ts", import.meta.url), {
      type: "module",
    });
    trackWorkloadEvent("workloads.worker_started", {
      worker: "deployments_rows",
      workload: "deployments",
    });
    deploymentsRowsWorker.onmessage = (event: MessageEvent<{
      id: number;
      enqueuedAt: number;
      startedAt: number;
      finishedAt: number;
      rows: DeploymentRow[];
    }>) => {
      const payload = event.data;
      if (!payload || payload.id !== deploymentsRowsWorkerRequestId) return;
      deploymentsRowsWorkerFailures = 0;
      deploymentsRowsWorkerResult = payload.rows;
      const queueMs = Math.max(0, payload.startedAt - payload.enqueuedAt);
      const computeMs = Math.max(0, payload.finishedAt - payload.startedAt);
      trackWorkloadEvent("workloads.worker_queue_ms", {
        worker: "deployments_rows",
        workload: "deployments",
        durationMs: queueMs,
        queueMs,
      });
      trackWorkloadEvent("workloads.worker_compute_ms", {
        worker: "deployments_rows",
        workload: "deployments",
        durationMs: computeMs,
        computeMs,
      });
    };
    deploymentsRowsWorker.onerror = () => {
      deploymentsRowsWorkerFailures += 1;
      trackWorkloadEvent("workloads.worker_error", {
        worker: "deployments_rows",
        workload: "deployments",
        failures: deploymentsRowsWorkerFailures,
      });
      if (deploymentsRowsWorkerFailures >= 2) {
        deploymentsRowsWorkerDisabled = true;
        stopDeploymentsRowsWorker();
        trackWorkloadEvent("workloads.worker_auto_rollback", {
          worker: "deployments_rows",
          workload: "deployments",
        });
      }
    };
  }

  function stopDeploymentsRowsWorker() {
    if (!deploymentsRowsWorker) return;
    deploymentsRowsWorker.terminate();
    deploymentsRowsWorker = null;
    deploymentsRowsWorkerResult = null;
    trackWorkloadEvent("workloads.worker_stopped", {
      worker: "deployments_rows",
      workload: "deployments",
    });
  }

  function scheduleDeploymentsRowsWorker() {
    if (!deploymentsRowsWorker) return;
    deploymentsRowsWorkerRequestId += 1;
    const requestId = deploymentsRowsWorkerRequestId;
    try {
      deploymentsRowsWorker.postMessage({
        id: requestId,
        enqueuedAt: Date.now(),
        deployments: rowsSource,
      });
    } catch {
      deploymentsRowsWorkerFailures += 1;
      deploymentsRowsWorkerDisabled = true;
      stopDeploymentsRowsWorker();
      trackWorkloadEvent("workloads.worker_auto_rollback", {
        worker: "deployments_rows",
        workload: "deployments",
        reason: "post_message_failed",
      });
    }
  }

  $effect(() => {
    if (!shouldUseDeploymentsRowsWorker) {
      deploymentsRowsWorkerResult = null;
      return;
    }
    if (!deploymentsRowsWorker) return;
    rowsSource;
    scheduleDeploymentsRowsWorker();
  });

  onMount(() => {
    const runtimeClockTimer = setInterval(() => {
      runtimeClockNow = Date.now();
    }, 5_000);
    startDeploymentsRowsWorker();
    if (data?.slug) {
      pendingWorkbenchState = loadWorkbenchState(data.slug);
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

  $effect(() => {
    if (!isOpen || !selectedItem) return;
    const key = toActiveDetailsKey();
    if (!key) return;
    if (detailsKeyLoaded === key) return;
    void loadDetailsData();
  });

  $effect(() => {
    const nextSelection = pruneSelectedDeployments(selectedDeploymentIds, availableIds);
    if (nextSelection !== selectedDeploymentIds) {
      selectedDeploymentIds = nextSelection;
    }
  });

  $effect(() => {
    if (workbenchStateRestored) return;
    if (pendingWorkbenchState === undefined) return;
    if (!pendingWorkbenchState) {
      workbenchStateRestored = true;
      return;
    }

    const state = pendingWorkbenchState;
    pendingWorkbenchState = null;

    const tabsToOpen = state.tabs.map((tab) => {
      const deployment =
        deploymentsSnapshot.find(
          (item) =>
            item.metadata?.name === tab.name &&
            (item.metadata?.namespace ?? "default") === tab.namespace,
        ) ?? buildPersistedDeploymentStub(tab.name, tab.namespace);
      return { tab, deployment };
    });

    for (const entry of tabsToOpen) {
      if (entry.tab.kind === "logs") {
        void openLogsForDeployment(entry.deployment);
      } else {
        void openYamlForDeployment(entry.deployment);
      }
    }

    const restoredPinnedIds = new Set(
      tabsToOpen
        .filter((entry) => entry.tab.pinned)
        .map((entry) => `${entry.tab.kind}:${entry.tab.namespace}/${entry.tab.name}`),
    );
    if (restoredPinnedIds.size > 0) {
      pinnedTabIds = new Set([...pinnedTabIds, ...restoredPinnedIds]);
    }

    setWorkbenchLayout(state.layout);
    const knownTabIds = new Set(workbenchTabs.map((tab) => tab.id));
    setPaneTabIdsIfChanged([
      state.paneTabIds[0] && knownTabIds.has(state.paneTabIds[0]) ? state.paneTabIds[0] : null,
      state.paneTabIds[1] && knownTabIds.has(state.paneTabIds[1]) ? state.paneTabIds[1] : null,
      state.paneTabIds[2] && knownTabIds.has(state.paneTabIds[2]) ? state.paneTabIds[2] : null,
    ]);
    setCollapsedPaneIndexesIfChanged(
      state.collapsedPaneIndexes.filter((idx) => idx >= 0 && idx < getPaneCount()),
    );
    closedWorkbenchTabs = state.closedTabs.map((entry) => ({
      kind: entry.kind,
      target: entry.target ? { ...entry.target } : null,
      pinned: entry.pinned,
    }));

    if (state.activeTabId && knownTabIds.has(state.activeTabId)) {
      activeWorkbenchTabId = state.activeTabId;
    }
    workbenchCollapsed = Boolean(state.workbenchCollapsed && workbenchTabs.length > 0);
    workbenchFullscreen = Boolean(
      state.workbenchFullscreen && workbenchTabs.length > 0 && !workbenchCollapsed,
    );
    workbenchStateRestored = true;
  });

  $effect(() => {
    if ($dashboardDataProfile.id !== "realtime") return;
    if (workbenchCollapsed) workbenchCollapsed = false;
    if (collapsedPaneIndexes.length > 0) collapsedPaneIndexes = [];
  });

  $effect(() => {
    if (!workbenchStateRestored) return;
    data?.slug;
    workbenchTabs;
    activeWorkbenchTabId;
    workbenchLayout;
    paneTabIds;
    collapsedPaneIndexes;
    closedWorkbenchTabs;
    pinnedTabIds;
    workbenchCollapsed;
    workbenchFullscreen;
    persistWorkbenchState();
  });

  $effect(() => {
    const recovery = recoverWorkbenchTabs({
      currentTabs: workbenchTabs,
      candidates: [
        ...logsTabs.map((tab) => ({
          id: tab.id,
          kind: "logs" as const,
          title: `Logs ${tab.target.name}`,
          subtitle: tab.target.namespace,
        })),
        ...yamlTabs.map((tab) => ({
          id: tab.id,
          kind: "yaml" as const,
          title: `YAML ${tab.target.name}`,
          subtitle: tab.target.namespace,
        })),
        ...eventsTabs.map((tab) => ({
          id: tab.id,
          kind: "events" as const,
          title: `Events ${tab.target.name}`,
          subtitle: tab.target.namespace,
        })),
        ...rolloutTabs.map((tab) => ({
          id: tab.id,
          kind:
            tab.mode === "status"
              ? ("rollout-status" as const)
              : ("rollout-history" as const),
          title: `${tab.mode === "status" ? "Rollout status" : "Rollout history"} ${tab.target.name}`,
          subtitle: tab.target.namespace,
        })),
      ],
      activeTabId: activeWorkbenchTabId,
    });
    if (!recovery) return;
    workbenchTabs = recovery.tabs as WorkbenchTab[];
    activeWorkbenchTabId = recovery.activeTabId;
  });

  $effect(() => {
    if (orderedWorkbenchTabs.length === 0) {
      activeWorkbenchTabId = null;
      workbenchCollapsed = false;
      workbenchFullscreen = false;
      workbenchLayout = "single";
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      yamlCompareSourceTabId = null;
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
      return;
    }
    const hasActive = orderedWorkbenchTabs.some((tab) => tab.id === activeWorkbenchTabId);
    if (!hasActive) {
      activeWorkbenchTabId = orderedWorkbenchTabs[0]?.id ?? null;
    }
    normalizePaneTabIdsForCurrentLayout();
  });

  $effect(() => {
    if (!yamlComparePair) return;
    const [leftId, rightId] = yamlComparePair;
    const leftExists = Boolean(getYamlTab(leftId));
    const rightExists = Boolean(getYamlTab(rightId));
    if (!leftExists || !rightExists) {
      yamlComparePair = null;
      yamlCompareTargetTabId = null;
    }
  });

  onDestroy(() => {
    persistWorkbenchState();
    detailsActions.abortAll();
    stopDeploymentsRowsWorker();
    stopWatcherTimer();
    mutationReconcile.clearScope();
    deploymentsSyncStoreUnsubscribe?.();
    deploymentsSyncStoreUnsubscribe = null;
    stopAllLiveLogs();
    if (!data?.slug) return;
    destroyDeploymentsSync(data.slug);
    resetDeploymentsSyncStatus(data.slug);
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="min-w-0 space-y-3">
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
      <MultiPaneWorkbench
        tabs={orderedWorkbenchTabs}
        activeTabId={activeWorkbenchTabId}
        isTabPinned={isTabPinned}
        onActivateTab={setActiveWorkbenchTab}
        onTogglePin={togglePinTab}
        onCloseTab={(tabId) => {
          void closeWorkbenchTab(tabId, { skipConfirm: true });
        }}
        onReopenLastClosedTab={reopenLastClosedTab}
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
                  selectedContainer={currentLogsTab?.logsSelectedContainer ?? "__all__"}
                  containerOptions={currentLogsTab?.logsContainerOptions ?? ["__all__"]}
                  bookmarks={currentLogsTab?.bookmarks ?? []}
                  onToggleLive={() => {
                    if (!currentLogsTab) return;
                    const nextLive = !currentLogsTab.logsLive;
                    updateLogsTab(currentLogsTab.id, (tab) => ({ ...tab, logsLive: nextLive }));
                    if (nextLive) startLiveLogsForTab(currentLogsTab.id);
                    else stopLiveLogsForTab(currentLogsTab.id);
                  }}
                  onSetMode={(mode) => {
                    if (!currentLogsTab || currentLogsTab.logsMode === mode) return;
                    updateLogsTab(currentLogsTab.id, (tab) => ({ ...tab, logsMode: mode, logsError: null }));
                    if (currentLogsTab.logsLive) startLiveLogsForTab(currentLogsTab.id);
                  }}
                  onTogglePrevious={() => {
                    if (!currentLogsTab) return;
                    updateLogsTab(currentLogsTab.id, (tab) => ({
                      ...tab,
                      logsPrevious: !tab.logsPrevious,
                    }));
                    if (currentLogsTab.logsLive) startLiveLogsForTab(currentLogsTab.id);
                    else void loadLogsForTab(currentLogsTab.id);
                  }}
                  onSelectContainer={(container) => {
                    if (!currentLogsTab) return;
                    updateLogsTab(currentLogsTab.id, (tab) => ({
                      ...tab,
                      logsSelectedContainer: container || "__all__",
                    }));
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
                  driftDetected={currentYamlTab?.yamlDriftDetected ?? false}
                  driftMessage={currentYamlTab?.yamlDriftMessage ?? null}
                  onYamlChange={(value) => {
                    if (!currentYamlTab) return;
                    updateYamlTab(currentYamlTab.id, (tab) => ({ ...tab, yamlText: value }));
                  }}
                  onRefresh={() => {
                    if (!currentYamlTab) return;
                    refreshYamlForTab(currentYamlTab.id);
                  }}
                  onSave={() => {
                    if (!currentYamlTab) return;
                    void saveDeploymentYaml(currentYamlTab.id);
                  }}
                  onReloadFromCluster={() => {
                    if (!currentYamlTab) return;
                    refreshYamlForTab(currentYamlTab.id);
                  }}
                  onRebaseEdits={() => {
                    if (!currentYamlTab) return;
                    rebaseDeploymentYamlEdits(currentYamlTab.id);
                  }}
                />
              {:else if activeWorkbenchTab.kind === "events"}
                {@const currentEventsTab = getEventsTab(activeWorkbenchTab.id)}
                <WorkloadEventsSheet
                  embedded={true}
                  isOpen={workbenchOpen}
                  title={`Deployment events: ${currentEventsTab ? `${currentEventsTab.target.namespace}/${currentEventsTab.target.name}` : "-"}`}
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
                          resource: "deployment",
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
                    const deployment = target ? findDeploymentByTarget(target) : null;
                    if (!currentRolloutTab || !deployment) return;
                    void openRolloutCommandForDeployment(currentRolloutTab.mode, deployment);
                  }}
                />
              {/if}
            {:else}
              <div class="flex h-full gap-2 p-2">
                {#each paneIndexes as paneIndex}
                  {@const paneTab = getPaneTab(paneIndex)}
                  <div class={`${getPaneWrapperClass(paneIndex)} min-h-0 overflow-hidden rounded border`}>
                    {#if paneTab && isPaneCollapsed(paneIndex)}
                      {#if paneTab.kind === "yaml"}
                        {@const paneYamlTab = getYamlTab(paneTab.id)}
                        {#if paneYamlTab}
                          <ResourceYamlSheet
                            embedded={true}
                            isOpen={workbenchOpen}
                            podRef={`${paneYamlTab.target.namespace}/${paneYamlTab.target.name}`}
                            originalYaml={paneYamlTab.yamlOriginalText}
                            yamlText={paneYamlTab.yamlText}
                            loading={paneYamlTab.yamlLoading}
                            saving={paneYamlTab.yamlSaving}
                            hasChanges={paneYamlTab.yamlText !== paneYamlTab.yamlOriginalText}
                            externalDiffLines={getYamlCompareDiffLines(paneYamlTab.id)}
                            error={paneYamlTab.yamlError}
                            driftDetected={paneYamlTab.yamlDriftDetected}
                            driftMessage={paneYamlTab.yamlDriftMessage}
                            isVerticallyCollapsed
                            canVerticalCollapse={true}
                            onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                            onYamlChange={(value) => {
                              updateYamlTab(paneYamlTab.id, (tab) => ({ ...tab, yamlText: value }));
                            }}
                            onRefresh={() => {
                              refreshYamlForTab(paneYamlTab.id);
                            }}
                            onSave={() => {
                              void saveDeploymentYaml(paneYamlTab.id);
                            }}
                            onReloadFromCluster={() => {
                              refreshYamlForTab(paneYamlTab.id);
                            }}
                            onRebaseEdits={() => {
                              rebaseDeploymentYamlEdits(paneYamlTab.id);
                            }}
                          />
                        {/if}
                      {:else if paneTab.kind === "events"}
                        {@const paneEventsTab = getEventsTab(paneTab.id)}
                        {#if paneEventsTab}
                          <WorkloadEventsSheet
                            embedded={true}
                            isOpen={workbenchOpen}
                            title={`Deployment events: ${paneEventsTab.target.namespace}/${paneEventsTab.target.name}`}
                            targetRef={`${paneEventsTab.target.namespace}/${paneEventsTab.target.name}`}
                            events={paneEventsTab.events}
                            loading={paneEventsTab.eventsLoading}
                            error={paneEventsTab.eventsError}
                            isVerticallyCollapsed
                            canVerticalCollapse={true}
                            onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                          />
                        {/if}
                      {:else if paneTab.kind === "rollout-status" || paneTab.kind === "rollout-history"}
                        {@const paneRolloutTab = getRolloutTab(paneTab.id)}
                        {#if paneRolloutTab}
                          <WorkloadCommandOutputSheet
                            embedded={true}
                            isOpen={workbenchOpen}
                            title={`${paneTab.kind === "rollout-status" ? "Rollout status" : "Rollout history"}: ${paneRolloutTab.target.namespace}/${paneRolloutTab.target.name}`}
                            collapsedLabel={paneRolloutTab.target.name}
                            commandLabel={buildRolloutCommandArgs(paneRolloutTab.mode, {
                              resource: "deployment",
                              name: paneRolloutTab.target.name,
                              namespace: paneRolloutTab.target.namespace,
                            }).join(" ")}
                            output={paneRolloutTab.output}
                            loading={paneRolloutTab.loading}
                            error={paneRolloutTab.error}
                            isVerticallyCollapsed
                            canVerticalCollapse={true}
                            onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                            onRefresh={() => {
                              const deployment = findDeploymentByTarget(paneRolloutTab.target);
                              if (!deployment) return;
                              void openRolloutCommandForDeployment(paneRolloutTab.mode, deployment);
                            }}
                          />
                        {/if}
                      {:else}
                        {@const paneLogsTab = getLogsTab(paneTab.id)}
                        {#if paneLogsTab}
                          <ResourceLogsSheet
                            embedded={true}
                            isOpen={workbenchOpen}
                            podRef={`${paneLogsTab.target.namespace}/${paneLogsTab.target.name}`}
                            logs={paneLogsTab.logsText}
                            loading={paneLogsTab.logsLoading}
                            error={paneLogsTab.logsError}
                            isLive={paneLogsTab.logsLive}
                            mode={paneLogsTab.logsMode}
                            lastUpdatedAt={paneLogsTab.logsUpdatedAt}
                            previous={paneLogsTab.logsPrevious}
                            selectedContainer={paneLogsTab.logsSelectedContainer}
                            containerOptions={paneLogsTab.logsContainerOptions}
                            bookmarks={paneLogsTab.bookmarks}
                            isVerticallyCollapsed
                            canVerticalCollapse={true}
                            onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                            onToggleLive={() => {
                              const nextLive = !paneLogsTab.logsLive;
                              updateLogsTab(paneLogsTab.id, (tab) => ({ ...tab, logsLive: nextLive }));
                              if (nextLive) startLiveLogsForTab(paneLogsTab.id);
                              else stopLiveLogsForTab(paneLogsTab.id);
                            }}
                            onSetMode={(mode) => {
                              if (paneLogsTab.logsMode === mode) return;
                              updateLogsTab(paneLogsTab.id, (tab) => ({ ...tab, logsMode: mode, logsError: null }));
                              if (paneLogsTab.logsLive) startLiveLogsForTab(paneLogsTab.id);
                            }}
                            onTogglePrevious={() => {
                              updateLogsTab(paneLogsTab.id, (tab) => ({
                                ...tab,
                                logsPrevious: !tab.logsPrevious,
                              }));
                              if (paneLogsTab.logsLive) startLiveLogsForTab(paneLogsTab.id);
                              else void loadLogsForTab(paneLogsTab.id);
                            }}
                            onSelectContainer={(container) => {
                              updateLogsTab(paneLogsTab.id, (tab) => ({
                                ...tab,
                                logsSelectedContainer: container || "__all__",
                              }));
                              if (paneLogsTab.logsLive) startLiveLogsForTab(paneLogsTab.id);
                              else void loadLogsForTab(paneLogsTab.id);
                            }}
                            onRefresh={() => {
                              void loadLogsForTab(paneLogsTab.id);
                            }}
                            onAddBookmark={(line) => {
                              updateLogsTab(paneLogsTab.id, (tab) => ({
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
                              updateLogsTab(paneLogsTab.id, (tab) => ({
                                ...tab,
                                bookmarks: tab.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
                              }));
                            }}
                            jumpToLine={logsJumpToLine}
                            onJumpHandled={() => {
                              logsJumpToLine = null;
                            }}
                          />
                        {/if}
                      {/if}
                    {:else}
                      <div class="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
                        <span class="text-muted-foreground">{getPaneLabel(paneIndex)}</span>
                        <select
                          class="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={paneTabIds[paneIndex] ?? ""}
                          onchange={(event) => assignTabToPane(paneIndex, event.currentTarget.value || null)}
                        >
                          <option value="">Select tab</option>
                          {#each orderedWorkbenchTabs as tab}
                            <option value={tab.id}>{tab.title} ({tab.subtitle})</option>
                          {/each}
                        </select>
                      </div>
                      {#if paneTab}
                        {#if paneTab.kind === "logs"}
                          {@const paneLogsTab = getLogsTab(paneTab.id)}
                          {#if paneLogsTab}
                            <ResourceLogsSheet
                              embedded={true}
                              isOpen={workbenchOpen}
                              podRef={`${paneLogsTab.target.namespace}/${paneLogsTab.target.name}`}
                              logs={paneLogsTab.logsText}
                              loading={paneLogsTab.logsLoading}
                              error={paneLogsTab.logsError}
                              isLive={paneLogsTab.logsLive}
                              mode={paneLogsTab.logsMode}
                              lastUpdatedAt={paneLogsTab.logsUpdatedAt}
                              previous={paneLogsTab.logsPrevious}
                              selectedContainer={paneLogsTab.logsSelectedContainer}
                              containerOptions={paneLogsTab.logsContainerOptions}
                              bookmarks={paneLogsTab.bookmarks}
                              canVerticalCollapse={getPaneCount() > 1}
                              isVerticallyCollapsed={false}
                              onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                              onToggleLive={() => {
                                const nextLive = !paneLogsTab.logsLive;
                                updateLogsTab(paneLogsTab.id, (tab) => ({ ...tab, logsLive: nextLive }));
                                if (nextLive) startLiveLogsForTab(paneLogsTab.id);
                                else stopLiveLogsForTab(paneLogsTab.id);
                              }}
                              onSetMode={(mode) => {
                                if (paneLogsTab.logsMode === mode) return;
                                updateLogsTab(paneLogsTab.id, (tab) => ({ ...tab, logsMode: mode, logsError: null }));
                                if (paneLogsTab.logsLive) startLiveLogsForTab(paneLogsTab.id);
                              }}
                              onTogglePrevious={() => {
                                updateLogsTab(paneLogsTab.id, (tab) => ({
                                  ...tab,
                                  logsPrevious: !tab.logsPrevious,
                                }));
                                if (paneLogsTab.logsLive) startLiveLogsForTab(paneLogsTab.id);
                                else void loadLogsForTab(paneLogsTab.id);
                              }}
                              onSelectContainer={(container) => {
                                updateLogsTab(paneLogsTab.id, (tab) => ({
                                  ...tab,
                                  logsSelectedContainer: container || "__all__",
                                }));
                                if (paneLogsTab.logsLive) startLiveLogsForTab(paneLogsTab.id);
                                else void loadLogsForTab(paneLogsTab.id);
                              }}
                              onRefresh={() => {
                                void loadLogsForTab(paneLogsTab.id);
                              }}
                              onAddBookmark={(line) => {
                                updateLogsTab(paneLogsTab.id, (tab) => ({
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
                                updateLogsTab(paneLogsTab.id, (tab) => ({
                                  ...tab,
                                  bookmarks: tab.bookmarks.filter((bookmark) => bookmark.id !== bookmarkId),
                                }));
                              }}
                              jumpToLine={logsJumpToLine}
                              onJumpHandled={() => {
                                logsJumpToLine = null;
                              }}
                            />
                          {/if}
                        {:else if paneTab.kind === "yaml"}
                          {@const paneYamlTab = getYamlTab(paneTab.id)}
                          {#if paneYamlTab}
                            <ResourceYamlSheet
                              embedded={true}
                              isOpen={workbenchOpen}
                              podRef={`${paneYamlTab.target.namespace}/${paneYamlTab.target.name}`}
                              originalYaml={paneYamlTab.yamlOriginalText}
                              yamlText={paneYamlTab.yamlText}
                              loading={paneYamlTab.yamlLoading}
                              saving={paneYamlTab.yamlSaving}
                              hasChanges={paneYamlTab.yamlText !== paneYamlTab.yamlOriginalText}
                              externalDiffLines={getYamlCompareDiffLines(paneYamlTab.id)}
                              error={paneYamlTab.yamlError}
                              driftDetected={paneYamlTab.yamlDriftDetected}
                              driftMessage={paneYamlTab.yamlDriftMessage}
                              canVerticalCollapse={getPaneCount() > 1}
                              isVerticallyCollapsed={false}
                              onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                              onYamlChange={(value) => {
                                updateYamlTab(paneYamlTab.id, (tab) => ({ ...tab, yamlText: value }));
                              }}
                              onRefresh={() => {
                                refreshYamlForTab(paneYamlTab.id);
                              }}
                              onSave={() => {
                                void saveDeploymentYaml(paneYamlTab.id);
                              }}
                              onReloadFromCluster={() => {
                                refreshYamlForTab(paneYamlTab.id);
                              }}
                              onRebaseEdits={() => {
                                rebaseDeploymentYamlEdits(paneYamlTab.id);
                              }}
                            />
                          {/if}
                        {:else if paneTab.kind === "events"}
                          {@const paneEventsTab = getEventsTab(paneTab.id)}
                          {#if paneEventsTab}
                            <WorkloadEventsSheet
                              embedded={true}
                              isOpen={workbenchOpen}
                              title={`Deployment events: ${paneEventsTab.target.namespace}/${paneEventsTab.target.name}`}
                              targetRef={`${paneEventsTab.target.namespace}/${paneEventsTab.target.name}`}
                              events={paneEventsTab.events}
                              loading={paneEventsTab.eventsLoading}
                              error={paneEventsTab.eventsError}
                              canVerticalCollapse={getPaneCount() > 1}
                              isVerticallyCollapsed={false}
                              onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                            />
                          {/if}
                        {:else if paneTab.kind === "rollout-status" || paneTab.kind === "rollout-history"}
                          {@const paneRolloutTab = getRolloutTab(paneTab.id)}
                          {#if paneRolloutTab}
                            <WorkloadCommandOutputSheet
                              embedded={true}
                              isOpen={workbenchOpen}
                              title={`${paneTab.kind === "rollout-status" ? "Rollout status" : "Rollout history"}: ${paneRolloutTab.target.namespace}/${paneRolloutTab.target.name}`}
                              collapsedLabel={paneRolloutTab.target.name}
                              commandLabel={buildRolloutCommandArgs(paneRolloutTab.mode, {
                                resource: "deployment",
                                name: paneRolloutTab.target.name,
                                namespace: paneRolloutTab.target.namespace,
                              }).join(" ")}
                              output={paneRolloutTab.output}
                              loading={paneRolloutTab.loading}
                              error={paneRolloutTab.error}
                              canVerticalCollapse={getPaneCount() > 1}
                              isVerticallyCollapsed={false}
                              onToggleVerticalCollapse={() => togglePaneCollapsed(paneIndex)}
                              onRefresh={() => {
                                const deployment = findDeploymentByTarget(paneRolloutTab.target);
                                if (!deployment) return;
                                void openRolloutCommandForDeployment(paneRolloutTab.mode, deployment);
                              }}
                            />
                          {/if}
                        {/if}
                      {:else}
                        <div class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
                          Select tab for {getPaneLabel(paneIndex).toLowerCase()}
                        </div>
                      {/if}
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        {/snippet}
      </MultiPaneWorkbench>
    {/if}
  {#if selectedDeploymentIds.size > 0}
    <WorkloadSelectionBar count={selectedDeploymentIds.size}>
      {#snippet children()}
        <DeploymentBulkActions
          mode={selectedDeploymentIds.size === 1 ? "single" : "multi"}
          disabled={actionInFlight}
          onShowDetails={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            openSheet(selected[0]);
          }}
          onLogs={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void openLogsForDeployment(selected[0]);
          }}
          onEvents={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void openEventsForDeployment(selected[0]);
          }}
          onEditYaml={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void openYamlForDeployment(selected[0]);
          }}
          onInvestigate={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void openDeploymentInvestigationWorkspace(selected[0]);
          }}
          onCopyDescribe={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void copyDescribeCommandForDeployment(selected[0]);
          }}
          onRunDebugDescribe={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            openDebugDescribeForDeployment(selected[0]);
          }}
          onRolloutStatus={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void openRolloutCommandForDeployment("status", selected[0]);
          }}
          onRolloutHistory={() => {
            const selected = getSelectedDeployments();
            if (selected.length !== 1) return;
            void openRolloutCommandForDeployment("history", selected[0]);
          }}
          onDownloadYaml={() => {
            const selected = getSelectedDeployments();
            void downloadYamlForDeployments(selected);
          }}
          onRestart={() => {
            void rolloutAction("restart", getSelectedDeployments());
          }}
          onPause={() => {
            void rolloutAction("pause", getSelectedDeployments());
          }}
          onResume={() => {
            void rolloutAction("resume", getSelectedDeployments());
          }}
          onUndo={() => {
            void rolloutAction("undo", getSelectedDeployments());
          }}
          onDelete={() => {
            void deleteDeployments(getSelectedDeployments());
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={actionInFlight}
          onclick={() => {
            selectedDeploymentIds = new Set<string>();
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
        { label: "Namespace", value: deploymentsNamespaceSummary },
        { label: "Deployments", value: rows.length },
        { label: "Sync", value: deploymentsRuntimeSourceState },
      ]}
      trailingItem={{
        label: "View",
        value: deploymentsSummaryView,
        valueClass: "text-foreground",
      }}
    />
    <div class="mb-4">
      <SectionRuntimeStatus
        sectionLabel="Deployments Runtime Status"
        profileLabel={deploymentsRuntimeProfileLabel}
        sourceState={deploymentsRuntimeSourceState}
        mode={watcherPolicy.mode === "stream" ? "stream" : "poll"}
        budgetSummary={`sync ${watcherPolicy.refreshSeconds}s`}
        lastUpdatedLabel={deploymentsRuntimeLastUpdatedLabel}
        detail={deploymentsRuntimeDetail}
        secondaryActionLabel="Update"
        secondaryActionAriaLabel="Refresh deployments runtime section"
        secondaryActionLoading={watcherInFlight}
        onSecondaryAction={() => void refreshDeploymentsFromWatcher("manual")}
        reason={deploymentsRuntimeReason}
        actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
        actionAriaLabel={watcherEnabled ? "Pause deployments runtime section" : "Resume deployments runtime section"}
        onAction={toggleWatcher}
      />
    </div>
    <DataTable
      data={rows}
      {columns}
      {watcherEnabled}
      {watcherRefreshSeconds}
      {watcherError}
      viewMode={deploymentsTableViewMode}
      onToggleWatcher={toggleWatcher}
      onWatcherRefreshSecondsChange={setWatcherRefreshSeconds}
      onResetWatcherSettings={resetWatcherSettings}
      onCsvDownloaded={({ pathHint, rows: csvRows }) => {
        actionNotification = null;
        actionNotification = notifySuccess(`CSV exported: ${pathHint} (${csvRows} rows).`);
      }}
      onViewModeChange={(mode) => {
        deploymentsTableViewMode = mode;
        persistWatcherSettings();
      }}
      isRowSelected={(row) => selectedDeploymentIds.has(row.uid)}
      onToggleGroupSelection={toggleGroupSelection}
      onRowClick={(row) => {
        openSheetByRow(row);
      }}
    />
  </div>
  {#if isOpen && selectedItem}
  <DetailsSheetPortal open={isOpen} onClose={closeDetails} closeAriaLabel="Close deployment details">
        <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div class="min-w-0 flex items-center gap-2">
            <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
            <div class="truncate text-base font-semibold">
              Deployment: {selectedItem.metadata?.name ?? "-"}
            </div>
          </div>
          <DetailsHeaderActions
            actions={[
              {
                id: "logs",
                title: "Logs",
                ariaLabel: "Open deployment logs",
                icon: ScrollText,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openLogsForDeployment(item));
                },
              },
              {
                id: "events",
                title: "Events",
                ariaLabel: "Open deployment events",
                icon: Clock3,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openEventsForDeployment(item));
                },
              },
              {
                id: "edit-yaml",
                title: "Edit YAML",
                ariaLabel: "Edit deployment YAML",
                icon: Pencil,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openYamlForDeployment(item));
                },
              },
              {
                id: "investigate",
                title: "Investigate",
                ariaLabel: "Investigate deployment",
                icon: Search,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openDeploymentInvestigationWorkspace(item));
                },
              },
              {
                id: "copy-describe",
                title: "Copy kubectl describe",
                ariaLabel: "Copy kubectl describe for deployment",
                icon: ClipboardList,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => copyDescribeCommandForDeployment(item));
                },
              },
              {
                id: "download-yaml",
                title: "Download YAML",
                ariaLabel: "Download deployment YAML",
                icon: FileDown,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => downloadYamlForDeployments([item]));
                },
              },
              {
                id: "restart",
                title: "Rollout restart",
                ariaLabel: "Rollout restart deployment",
                icon: RotateCcw,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => rolloutAction("restart", [item]));
                },
              },
              {
                id: "rollout-status",
                title: "Rollout status",
                ariaLabel: "Open rollout status for deployment",
                icon: Clock3,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openRolloutCommandForDeployment("status", item));
                },
              },
              {
                id: "rollout-history",
                title: "Rollout history",
                ariaLabel: "Open rollout history for deployment",
                icon: ListTree,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openRolloutCommandForDeployment("history", item));
                },
              },
              {
                id: "pause",
                title: "Pause rollout",
                ariaLabel: "Pause rollout",
                icon: Pause,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => rolloutAction("pause", [item]));
                },
              },
              {
                id: "resume",
                title: "Resume rollout",
                ariaLabel: "Resume rollout",
                icon: Play,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => rolloutAction("resume", [item]));
                },
              },
              {
                id: "undo",
                title: "Undo revision",
                ariaLabel: "Undo rollout revision",
                icon: Undo2,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => rolloutAction("undo", [item]));
                },
              },
              {
                id: "delete",
                title: "Delete",
                ariaLabel: "Delete deployment",
                icon: Trash,
                destructive: true,
                onClick: () => {
                  const item = selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => deleteDeployments([item]));
                },
              },
            ]}
            closeAriaLabel="Close details"
            onClose={closeDetails}
          />
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <div class="text-xs text-muted-foreground">
            Namespace: {selectedItem.metadata?.namespace ?? "default"} · Node: {getDetailsHeaderNode()} · Pod IP:
            {getDetailsHeaderPodIp()}
          </div>
          <DetailsExplainState
            sourceState={deploymentsRuntimeSourceState}
            profileLabel={deploymentsRuntimeProfileLabel}
            lastUpdatedLabel={deploymentsRuntimeLastUpdatedLabel}
            detail={deploymentsRuntimeDetail}
            reason={deploymentsRuntimeReason}
            requestPath={watcherPolicy.mode === "stream" ? "kubectl watch stream for deployments" : `poll every ${watcherPolicy.refreshSeconds}s`}
            describeCommand={getDeploymentDescribeCommand()}
            syncError={detailsError ?? watcherError}
          />
          <ResourceTrafficChain
            clusterId={data.slug}
            resourceKind="Deployment"
            resourceName={selectedItem.metadata?.name ?? ""}
            resourceNamespace={selectedItem.metadata?.namespace ?? "default"}
            raw={selectedItem as unknown as Record<string, unknown>}
          />

          <h3 class="my-4 font-bold">Properties</h3>
            <div class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Created</div>
              <div>{formatCreatedLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Name</div>
              <div>{selectedItem.metadata?.name ?? "-"}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Namespace</div>
              <div>{selectedItem.metadata?.namespace ?? "default"}</div>
            </div>
            <KeyValueExpand
              title="Labels"
              entries={getLabelEntries()}
              emptyText="No labels."
              contextKey={`${selectedItem.metadata?.namespace ?? "default"}/${selectedItem.metadata?.name ?? "-"}`}
              variant="card"
            />
            <KeyValueExpand
              title="Annotations"
              entries={getAnnotationEntries()}
              emptyText="No annotations."
              contextKey={`${selectedItem.metadata?.namespace ?? "default"}/${selectedItem.metadata?.name ?? "-"}`}
              variant="card"
            />
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Replicas</div>
              <div>{getReplicasLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Selector</div>
              <div>{getSelectorLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Node Selector</div>
              <div>{getNodeSelectorLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Strategy Type</div>
              <div>{(selectedItem.spec as { strategy?: { type?: string } } | undefined)?.strategy?.type ?? "-"}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Status</div>
              <div class={`inline-flex items-center gap-2 font-medium ${getStatusToneClasses(getDeploymentStatus(selectedItem)).text}`}>
                <span class={`inline-block h-2.5 w-2.5 rounded-full ${getStatusToneClasses(getDeploymentStatus(selectedItem)).dot}`}></span>
                {getDeploymentStatus(selectedItem)}
              </div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Conditions</div>
              {#if getConditionTypes().length === 0}
                <div>-</div>
              {:else}
                <div class="mt-1 flex flex-wrap gap-1.5">
                  {#each getConditionTypes() as condition}
                    <span class="rounded border border-emerald-300/70 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300">
                      {condition}
                    </span>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Pod Anti Affinities</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showPodAntiAffinitiesDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showPodAntiAffinitiesDetails = !showPodAntiAffinitiesDetails)}
              >
                <span>{getPodAntiAffinityRulesCount()} Rule{getPodAntiAffinityRulesCount() === 1 ? "" : "s"}</span>
                {#if showPodAntiAffinitiesDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showPodAntiAffinitiesDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getPodAntiAffinityDetails().length === 0}
                    <div class="text-muted-foreground">No pod anti-affinity rules.</div>
                  {:else}
                    {#each getPodAntiAffinityDetails() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            </div>
          <h3 class="my-4 font-bold">Deploy Revisions</h3>
            <div class="space-y-1 text-sm">
            {#if detailsRevisions.length === 0}
              <div class="text-muted-foreground">No revisions found.</div>
            {:else}
              {#each detailsRevisions as revision}
                <div class="grid grid-cols-[80px_90px_1fr] gap-2 rounded border p-2">
                  <div>{revision.revision}</div>
                  <div>{revision.pods}</div>
                  <div>{revision.age}</div>
                </div>
              {/each}
            {/if}
            </div>
          <h3 class="my-4 font-bold">Pods</h3>
            <div class="space-y-1 text-sm">
            {#if detailsPods.length === 0}
              <div class="text-muted-foreground">No pods found.</div>
            {:else}
              {#each detailsPods as pod}
                <div class="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[2fr_2fr_1fr_1fr_1fr_1fr_1fr]">
                  <div>{pod.name}</div>
                  <div>{pod.node}</div>
                  <div>{pod.namespace}</div>
                  <div>{pod.ready}</div>
                  <div>{pod.cpu}</div>
                  <div>{pod.memory}</div>
                  <div class={`inline-flex items-center gap-2 ${getPodStatusToneClasses(pod.status).text}`}>
                    <span class={`inline-block h-2 w-2 rounded-full ${getPodStatusToneClasses(pod.status).dot}`}></span>
                    {pod.status}
                  </div>
                </div>
              {/each}
            {/if}
            </div>
          <h3 class="my-4 font-bold">Events</h3>
          <DetailsEventsList
            events={detailsEvents}
            loading={detailsLoading}
            error={detailsError}
            emptyText="No events found."
          />
          {#if detailsLoading}
            <div class="mt-3 text-sm text-muted-foreground">Loading deployment details...</div>
          {/if}
          {#if detailsError}
            <div class="mt-3 rounded border border-rose-300/80 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/20 dark:text-rose-100">
              {detailsError}
            </div>
          {/if}
        </div>
  </DetailsSheetPortal>
  {/if}
