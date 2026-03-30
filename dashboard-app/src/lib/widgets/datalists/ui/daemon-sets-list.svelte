<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import DetailsSheetPortal from "$shared/ui/details-sheet-portal.svelte";
  import { onDestroy, onMount } from "svelte";
  import { path } from "@tauri-apps/api";
  import { BaseDirectory, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
  import { writable } from "svelte/store";
  import type { ColumnDef } from "@tanstack/table-core";
  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import { selectedNamespace } from "$features/namespace-management";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import {
    applyDaemonSetEvent,
    destroyDaemonSetsSync,
    initDaemonSetsSync,
    markDaemonSetsSyncError,
    markDaemonSetsSyncLoading,
    markDaemonSetsSyncSuccess,
    resetDaemonSetsSyncStatus,
    selectClusterDaemonSets,
    setInitialDaemonSets,
    setDaemonSetsSyncEnabled,
  } from "$features/check-health";
  import {
    buildIncidentTimeline,
    buildYamlFilename,
    computeLayoutClosePlan,
    openStreamWithOptionalFallback,
    orderPinnedTabs,
    recoverWorkbenchTabs,
    type IncidentMarker,
  } from "$features/pods-workbench";
  import {
    kubectlRawArgsFront,
    kubectlStreamArgsFront,
    type KubectlStreamProcess,
  } from "$shared/api/kubectl-proxy";
  import { renderComponent } from "$shared/ui/data-table";
  import { Button, SortingButton } from "$shared/ui/button";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { ChevronDown, ChevronUp } from "$shared/ui/icons";
  import ClipboardList from "@lucide/svelte/icons/clipboard-list";
  import Clock3 from "@lucide/svelte/icons/clock-3";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import Info from "@lucide/svelte/icons/info";
  import ListTree from "@lucide/svelte/icons/list-tree";
  import Pencil from "@lucide/svelte/icons/pencil";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import ScrollText from "@lucide/svelte/icons/scroll-text";
  import Search from "@lucide/svelte/icons/search";
  import Trash from "@lucide/svelte/icons/trash";
  import Target from "@lucide/svelte/icons/target";
  import X from "@lucide/svelte/icons/x";
  import FileDown from "@lucide/svelte/icons/file-down";
  import * as Alert from "$shared/ui/alert";
  import { getTimeDifference, type DaemonSetItem } from "$shared";
  import ResourceLogsSheet from "./common/resource-logs-sheet.svelte";
  import ResourceYamlSheet from "./common/resource-yaml-sheet.svelte";
  import DataTable, { type DaemonSetsTableViewMode } from "./daemon-sets-list/data-table.svelte";
  import DaemonSetActionsMenu from "./daemon-sets-list/daemonset-actions-menu.svelte";
  import DaemonSetBulkActions from "./daemon-sets-list/daemonset-bulk-actions.svelte";
  import DaemonSetReadinessBadge from "./daemon-sets-list/daemonset-readiness-badge.svelte";
  import DaemonSetSelectionCheckbox from "./daemon-sets-list/daemonset-selection-checkbox.svelte";
  import DetailsHeaderActions from "./common/details-header-actions.svelte";
  import WorkloadCommandOutputSheet from "./common/workload-command-output-sheet.svelte";
  import WorkloadEventsSheet from "./common/workload-events-sheet.svelte";
  import { loadWorkloadEvents, type WorkloadEvent } from "./common/workload-events";
  import DetailsMetadataGrid from "./common/details-metadata-grid.svelte";
  import ResourceTrafficChain from "./common/resource-traffic-chain.svelte";
  import DetailsEventsList from "./common/details-events-list.svelte";
  import { buildRolloutCommandArgs, loadRolloutCommandOutput, type RolloutCommandMode } from "./common/workload-rollout";
  import {
    findDaemonSetItem,
    getFilteredDaemonSets,
    mapDaemonSetRows,
    pruneSelectedDaemonSetIds,
    type DaemonSetRow,
  } from "./daemon-sets-list/model";
  import {
    getDaemonSetsWorkbenchStateKey,
    parseDaemonSetsWorkbenchState,
    type PersistedDaemonSetsWorkbenchState,
    type PersistedDaemonSetsWorkbenchTab,
  } from "./daemon-sets-list/workbench-session";
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

  interface DaemonSetsListProps {
    data: PageData & { daemonsets?: DaemonSetItem[] };
  }

  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
    viewMode: DaemonSetsTableViewMode;
  };

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
  type WorkbenchLayout = "single" | "dual" | "triple";

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
  type DaemonSetDetailPod = {
    name: string;
    node: string;
    podIp: string;
    namespace: string;
    ready: string;
    cpu: string;
    memory: string;
    status: string;
  };

  type DaemonSetDetailEvent = {
    type: string;
    reason: string;
    message: string;
    lastTimestamp: string;
  };

  const WATCHER_SETTINGS_PREFIX = "dashboard.daemonsets.watcher.settings.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 30,
    viewMode: "flat",
  };
  const logsLivePollMs = 2_000;

  const { data }: DaemonSetsListProps = $props();

  let daemonSetsSnapshot = $state<DaemonSetItem[]>([]);
  const selectedItem = writable<DaemonSetItem | null>(null);
  const isSheetOpen = writable(false);
  const workbenchOpen = writable(true);

  let selectedDaemonSetIds = $state(new Set<string>());

  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let daemonSetsTableViewMode = $state<DaemonSetsTableViewMode>(DEFAULT_WATCHER_SETTINGS.viewMode);
  let watcherError = $state<string | null>(null);
  let lastWatcherSuccessAt = $state<number | null>(null);
  let runtimeClockNow = $state(Date.now());
  let watcherInFlight = $state(false);
  let watcherSettingsLoadedCluster = $state<string | null>(null);
  let daemonSetsSyncStarted = false;
  let daemonSetsSyncStoreUnsubscribe: (() => void) | null = null;
  const watcherPolicy = $derived.by(() =>
    resolveCoreResourceSyncPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
      supportsStream: true,
    }),
  );
  const watcherEngine = createWorkloadWatcher({
    workloadName: "daemonsets",
    isEnabled: () => watcherPolicy.enabled,
    getRefreshSeconds: () => watcherPolicy.refreshSeconds,
    onTick: async () => {
      await refreshDaemonSetsFromWatcher();
    },
  });
  const mutationReconcile = createMutationReconcile({
    isSyncEnabled: () => watcherPolicy.enabled,
    getSyncMode: () => watcherPolicy.mode,
    getClusterId: () => data?.slug ?? null,
    getScopeKey: () => "daemonset",
    refresh: () => refreshDaemonSetsFromWatcher(),
  });

  let actionInFlight = $state(false);
  
  import { notifySuccess, notifyError, type ActionNotification } from "$shared/lib/action-notification";
  let actionNotification = $state<ActionNotification>(null);
  let yamlDownloadError = $state<string | null>(null);
  let yamlDownloadMessage = $state<string | null>(null);
  let detailsLoading = $state(false);
  let detailsError = $state<string | null>(null);
  let detailsPods = $state<DaemonSetDetailPod[]>([]);
  let detailsEvents = $state<DaemonSetDetailEvent[]>([]);
  let detailsKeyLoaded = $state<string | null>(null);
  const detailsActions = createDetailsActionManager();
  let showImagesDetails = $state(false);
  let showNodeAffinitiesDetails = $state(false);
  let showTolerationsDetails = $state(false);

  let logsTabs = $state<LogsTabState[]>([]);
  let yamlTabs = $state<YamlTabState[]>([]);
  let eventsTabs = $state<EventsTabState[]>([]);
  let rolloutTabs = $state<RolloutTabState[]>([]);
  let workbenchTabs = $state<WorkbenchTab[]>([]);
  let activeWorkbenchTabId = $state<string | null>(null);
  let workbenchFullscreen = $state(false);
  let workbenchCollapsed = $state(false);
  let workbenchLayout = $state<WorkbenchLayout>("single");
  let paneTabIds = $state<[string | null, string | null, string | null]>([null, null, null]);
  let collapsedPaneIndexes = $state<number[]>([]);
  let pinnedTabIds = $state(new Set<string>());
  let closedWorkbenchTabs = $state<ClosedWorkbenchTab[]>([]);
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);
  let pendingWorkbenchState = $state<PersistedDaemonSetsWorkbenchState | null | undefined>(undefined);
  let workbenchStateRestored = $state(false);
  let logsJumpToLine = $state<number | null>(null);
  let incidentTimelineCursorId = $state<string | null>(null);
  let incidentTimelineDensity = $state<"all" | "warnings">("all");
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
  const daemonSetsRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const daemonSetsRuntimeSourceState = $derived.by(() => {
    if (!watcherPolicy.enabled) return "paused";
    if (watcherError && daemonSetsSnapshot.length > 0) return "cached";
    if (watcherError) return "error";
    if (watcherIsStale) return "stale";
    if (watcherInFlight && daemonSetsSnapshot.length > 0) return "cached";
    if (lastWatcherSuccessAt) return "live";
    if (daemonSetsSnapshot.length > 0) return "cached";
    return "idle";
  });
  const daemonSetsRuntimeLastUpdatedLabel = $derived.by(() => {
    void runtimeClockNow;
    if (!lastWatcherSuccessAt) return null;
    return `updated ${getTimeDifference(new Date(lastWatcherSuccessAt))} ago`;
  });
  const daemonSetsRuntimeDetail = $derived.by(() => {
    if (!watcherPolicy.enabled) {
      return "DaemonSet sync is paused until you refresh or re-enable the watcher.";
    }
    if (watcherError && daemonSetsSnapshot.length > 0) {
      return "Showing the last successful DaemonSet snapshot while background refresh is degraded.";
    }
    if (watcherError) return "DaemonSet sync is degraded and needs operator attention.";
    if (watcherIsStale) return "DaemonSet data has exceeded the freshness budget and should be refreshed.";
    if (watcherInFlight) return "Background DaemonSet refresh is currently in flight.";
    return "DaemonSet sync is operating within the current runtime budget.";
  });
  const daemonSetsRuntimeReason = $derived.by(() => {
    if (watcherError) return watcherError;
    return watcherPolicy.mode === "stream"
      ? "Streaming watcher active for daemon sets."
      : `Polling daemon sets every ${watcherPolicy.refreshSeconds}s.`;
  });
  const daemonSetsNamespaceSummary = $derived($selectedNamespace || "all");
  const daemonSetsSummaryView = $derived(
    daemonSetsTableViewMode === "namespace" ? "By namespace" : "Flat",
  );

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

  const daemonSets = $derived.by(() => {
    return getFilteredDaemonSets(daemonSetsSnapshot, $selectedNamespace);
  });
  const rows = $derived.by(() => {
    return mapDaemonSetRows(daemonSets, (creationTimestamp) =>
      getTimeDifference(
        creationTimestamp
          ? creationTimestamp instanceof Date
            ? creationTimestamp
            : new Date(creationTimestamp)
          : undefined,
      ),
    );
  });
  const availableIds = $derived(rows.map((item) => item.uid).filter(Boolean));
  const allSelected = $derived(
    availableIds.length > 0 && availableIds.every((id) => selectedDaemonSetIds.has(id)),
  );
  const hasSomeSelected = $derived(selectedDaemonSetIds.size > 0 && !allSelected);
  const selectedCount = $derived(selectedDaemonSetIds.size);
  const selectedDaemonSets = $derived.by(() => {
    const selected = new Set(selectedDaemonSetIds);
    return daemonSets.filter((item) => {
      const namespace = item.metadata?.namespace ?? "default";
      const name = item.metadata?.name ?? "-";
      return selected.has(`${namespace}/${name}`);
    });
  });

  const columns: ColumnDef<DaemonSetRow>[] = [
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
        return renderComponent(DaemonSetSelectionCheckbox, {
          checked: allSelected,
          indeterminate: hasSomeSelected,
          label: "Select all daemon sets",
          onToggle: (next: boolean) => toggleAllSelection(next),
        });
      },
      cell: ({ row }) => {
        return renderComponent(DaemonSetSelectionCheckbox, {
          checked: isDaemonSetSelected(row.original.uid),
          label: `Select daemon set ${row.original.name}`,
          onToggle: (next: boolean) => {
            toggleDaemonSetSelection(row.original.uid, next);
          },
        });
      },
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const daemonSet = findDaemonSetItem(daemonSetsSnapshot, row.original);
        return renderComponent(DaemonSetActionsMenu, {
          name: row.original.name,
          namespace: row.original.namespace,
          disabled: !daemonSet,
          isBusy: actionInFlight,
          onShowDetails: () => {
            if (daemonSet) openSheet(daemonSet);
          },
          onLogs: () => {
            if (daemonSet) void openLogsForDaemonSet(daemonSet);
          },
          onEvents: () => {
            if (daemonSet) void openEventsForDaemonSet(daemonSet);
          },
          onEditYaml: () => {
            if (daemonSet) void openYamlForDaemonSet(daemonSet);
          },
          onInvestigate: () => {
            if (daemonSet) void openDaemonSetInvestigationWorkspace(daemonSet);
          },
          onCopyDescribe: () => {
            if (daemonSet) void copyDescribeCommandForDaemonSet(daemonSet);
          },
          onRunDebugDescribe: () => {
            if (daemonSet) openDebugDescribeForDaemonSet(daemonSet);
          },
          onRolloutStatus: () => {
            if (daemonSet) void openRolloutCommandForDaemonSet("status", daemonSet);
          },
          onRolloutHistory: () => {
            if (daemonSet) void openRolloutCommandForDaemonSet("history", daemonSet);
          },
          onRestart: () => {
            if (daemonSet) void restartDaemonSets([daemonSet]);
          },
          onDownloadYaml: () => {
            if (daemonSet) void downloadYamlForDaemonSets([daemonSet]);
          },
          onDelete: () => {
            if (daemonSet) void deleteDaemonSets([daemonSet]);
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
      accessorKey: "nodes",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Nodes",
          onclick: column.getToggleSortingHandler(),
        }),
    },
    { accessorKey: "desired", header: "Desired" },
    { accessorKey: "current", header: "Current" },
    {
      accessorKey: "ready",
      header: "Ready",
      cell: ({ row }) =>
        renderComponent(DaemonSetReadinessBadge, {
          ready: row.original.ready,
          desired: row.original.desired,
        }),
    },
    { accessorKey: "updated", header: "Up-to-date" },
    { accessorKey: "available", header: "Available" },
    { accessorKey: "nodeSelector", header: "Node selector" },
    {
      accessorKey: "age",
      header: ({ column }) =>
        renderComponent(SortingButton, {
          label: "Age",
          onclick: column.getToggleSortingHandler(),
        }),
    },
  ];

  function openSheet(item: DaemonSetItem) {
    selectedItem.set(item);
    detailsKeyLoaded = null;
    detailsPods = [];
    detailsEvents = [];
    detailsError = null;
    showImagesDetails = false;
    showNodeAffinitiesDetails = false;
    showTolerationsDetails = false;
    isSheetOpen.set(true);
  }

  function closeDetails() {
    isSheetOpen.set(false);
  }

  async function runDetailsAction(action: () => void | Promise<void>) {
    closeDetails();
    await action();
  }

  function toActiveDetailsKey() {
    if (!$selectedItem) return null;
    return `${$selectedItem.metadata?.namespace ?? "default"}/${$selectedItem.metadata?.name ?? "-"}`;
  }

  function formatCreatedLabel() {
    const metadata = $selectedItem?.metadata as { creationTimestamp?: string | Date } | undefined;
    const created = metadata?.creationTimestamp;
    if (!created) return "-";
    const createdAt = new Date(created);
    return `${getTimeDifference(createdAt)} ago (${createdAt.toLocaleString()})`;
  }

  function getLabelEntries() {
    return Object.entries((($selectedItem?.metadata?.labels ?? {}) as Record<string, string>) ?? {});
  }

  function getAnnotationEntries() {
    const metadata = $selectedItem?.metadata as { annotations?: Record<string, string> } | undefined;
    return Object.entries((metadata?.annotations ?? {}) as Record<string, string>);
  }

  function getSelectorLabel() {
    const selector = ($selectedItem?.spec?.selector?.matchLabels ?? {}) as Record<string, string>;
    const entries = Object.entries(selector);
    if (entries.length === 0) return "-";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
  }

  function getNodeSelectorLabel() {
    const templateSpec = $selectedItem?.spec?.template?.spec as
      | { nodeSelector?: Record<string, string> }
      | undefined;
    const selector = (templateSpec?.nodeSelector ?? {}) as Record<string, string>;
    const entries = Object.entries(selector);
    if (entries.length === 0) return "-";
    return entries.map(([key, value]) => `${key}=${value}`).join(", ");
  }

  function getImages() {
    const templateSpec = $selectedItem?.spec?.template?.spec as
      | { containers?: Array<{ image?: string }> }
      | undefined;
    return (templateSpec?.containers ?? [])
      .map((container) => container.image?.trim())
      .filter((image): image is string => Boolean(image));
  }

  function getStrategyType() {
    const spec = $selectedItem?.spec as
      | { updateStrategy?: { type?: string }; strategy?: { type?: string } }
      | undefined;
    return spec?.updateStrategy?.type ?? spec?.strategy?.type ?? "RollingUpdate";
  }

  function getTolerationsCount() {
    const templateSpec = $selectedItem?.spec?.template?.spec as { tolerations?: unknown[] } | undefined;
    return templateSpec?.tolerations?.length ?? 0;
  }

  function getTolerationDetails() {
    const templateSpec = $selectedItem?.spec?.template?.spec as
      | {
          tolerations?: Array<{
            key?: string;
            operator?: string;
            value?: string;
            effect?: string;
            tolerationSeconds?: number;
          }>;
        }
      | undefined;
    const tolerations = templateSpec?.tolerations ?? [];
    return tolerations.map((item) => {
      const key = item.key ?? "*";
      const operator = item.operator ?? "Exists";
      const value = item.value ?? "-";
      const effect = item.effect ?? "-";
      const seconds = item.tolerationSeconds !== undefined ? String(item.tolerationSeconds) : "-";
      return `key=${key}; op=${operator}; value=${value}; effect=${effect}; seconds=${seconds}`;
    });
  }

  function getNodeAffinityRulesCount() {
    const templateSpec = $selectedItem?.spec?.template?.spec as
      | {
          affinity?: {
            nodeAffinity?: {
              requiredDuringSchedulingIgnoredDuringExecution?: unknown;
              preferredDuringSchedulingIgnoredDuringExecution?: unknown[];
            };
          };
        }
      | undefined;
    const nodeAffinity = templateSpec?.affinity?.nodeAffinity;
    if (!nodeAffinity) return 0;
    let count = 0;
    if (nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution) count += 1;
    count += nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution?.length ?? 0;
    return count;
  }

  function getNodeAffinityDetails() {
    const templateSpec = $selectedItem?.spec?.template?.spec as
      | {
          affinity?: {
            nodeAffinity?: {
              requiredDuringSchedulingIgnoredDuringExecution?: unknown;
              preferredDuringSchedulingIgnoredDuringExecution?: Array<{ weight?: number }>;
            };
          };
        }
      | undefined;
    const nodeAffinity = templateSpec?.affinity?.nodeAffinity;
    if (!nodeAffinity) return [];
    const lines: string[] = [];
    if (nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution) {
      lines.push("required rule");
    }
    for (const item of nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution ?? []) {
      lines.push(`preferred rule (weight=${item.weight ?? 0})`);
    }
    return lines;
  }

  function getPodStatusLabel() {
    if ($selectedItem?.status?.numberReady !== undefined) {
      return `Running: ${$selectedItem.status.numberReady}`;
    }
    const running = detailsPods.filter((pod) => pod.status.toLowerCase().includes("running")).length;
    return `Running: ${running}`;
  }

  function getPodStatusToneClasses(status: string) {
    const lower = status.toLowerCase();
    if (lower.includes("running")) return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" };
    if (lower.includes("pending")) return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" };
    if (lower.includes("error") || lower.includes("failed") || lower.includes("crash")) {
      return { dot: "bg-red-500", text: "text-red-700 dark:text-red-400" };
    }
    return { dot: "bg-slate-400", text: "text-muted-foreground" };
  }

  async function loadDetailsData() {
    if (!data?.slug || !$selectedItem) return;
    const name = $selectedItem.metadata?.name;
    const namespace = $selectedItem.metadata?.namespace ?? "default";
    if (!name) return;
    await detailsActions.runLatest("details", async ({ signal, isLatest }) => {
      detailsLoading = true;
      detailsError = null;
      try {
      const selector = ($selectedItem.spec?.selector?.matchLabels ?? {}) as Record<string, string>;
      const selectorQuery = Object.entries(selector)
        .map(([key, value]) => `${key}=${value}`)
        .join(",");

      const podsArgs = selectorQuery
        ? ["get", "pods", "--namespace", namespace, "-l", selectorQuery, "-o", "json"]
        : ["get", "pods", "--namespace", namespace, "-o", "json"];

      const [podsResponse, topResponse, eventsResponse] = await Promise.all([
        kubectlRawArgsFront(podsArgs, { clusterId: data.slug, signal }),
        kubectlRawArgsFront(
          ["top", "pods", "--namespace", namespace, ...(selectorQuery ? ["-l", selectorQuery] : []), "--no-headers"],
          { clusterId: data.slug, signal },
        ),
        kubectlRawArgsFront(
          [
            "get",
            "events",
            "--namespace",
            namespace,
            "--field-selector",
            `involvedObject.kind=DaemonSet,involvedObject.name=${name}`,
            "--sort-by=.lastTimestamp",
            "-o",
            "json",
          ],
          { clusterId: data.slug, signal },
        ),
      ]);

      if (!isLatest()) return;
      if (podsResponse.errors || podsResponse.code !== 0) {
        throw new Error(podsResponse.errors || "Failed to load daemon set pods.");
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
          status?: { phase?: string; podIP?: string; containerStatuses?: Array<{ ready?: boolean }> };
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
          podIp: item.status?.podIP ?? "-",
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

      detailsKeyLoaded = `${namespace}/${name}`;
      } catch (error) {
        if (!isLatest()) return;
        detailsError = error instanceof Error ? error.message : "Failed to load daemon set details.";
        detailsPods = [];
        detailsEvents = [];
      } finally {
        if (isLatest()) detailsLoading = false;
      }
    });
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

  function stopLiveLogsForTab(tabId: string) {
    const timer = logsLiveTimers.get(tabId);
    if (timer) clearInterval(timer);
    logsLiveTimers.delete(tabId);
    void stopStreamForTab(tabId);
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
    }, 1_200);
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
      `daemonset/${tab.target.name}`,
      "--namespace",
      tab.target.namespace,
      "--all-containers=true",
      "--tail=500",
      "--request-timeout=8s",
      "--follow",
    ];
    if (tab.logsPrevious) args.push("--previous");
    if (tab.logsSelectedContainer !== "__all__") {
      args.push("-c", tab.logsSelectedContainer);
    }

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
          if (!primaryProcess) throw new Error("Unable to start daemon set log stream.");
          return primaryProcess;
        },
        async () => {
          const primaryProcess = await openStream(args);
          if (!primaryProcess) throw new Error("Unable to start daemon set log stream.");
          return primaryProcess;
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
    if (next[0] === paneTabIds[0] && next[1] === paneTabIds[1] && next[2] === paneTabIds[2]) {
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

    const { occupiedRemovedPaneCount, tabsToClose } = computeLayoutClosePlan(paneTabIds, nextPaneCount);
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
    const daemonSet =
      daemonSetsSnapshot.find(
        (item) =>
          item.metadata?.name === entry.target?.name &&
          (item.metadata?.namespace ?? "default") === entry.target?.namespace,
      ) ?? null;
    if (!daemonSet) return;
    if (entry.kind === "logs") {
      void openLogsForDaemonSet(daemonSet);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `logs:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    if (entry.kind === "events") {
      void openEventsForDaemonSet(daemonSet);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `events:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    if (entry.kind === "rollout-status" || entry.kind === "rollout-history") {
      void openRolloutCommandForDaemonSet(entry.kind === "rollout-status" ? "status" : "history", daemonSet);
      if (entry.pinned) pinnedTabIds = new Set([...pinnedTabIds, `${entry.kind}:${entry.target.namespace}/${entry.target.name}`]);
      return;
    }
    void openYamlForDaemonSet(daemonSet);
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

  function jumpToIncidentMarker(marker: IncidentMarker) {
    incidentTimelineCursorId = marker.id;
    logsJumpToLine = typeof marker.line === "number" ? marker.line : null;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (activeWorkbenchTabId) {
      void closeWorkbenchTab(activeWorkbenchTabId);
      return;
    }
    if ($isSheetOpen) {
      isSheetOpen.set(false);
    }
  }

  async function loadLogsForTab(tabId: string) {
    if (!data?.slug) return;
    const tab = getLogsTab(tabId);
    if (!tab) return;

    updateLogsTab(tabId, (current) => ({ ...current, logsLoading: true, logsError: null }));

    const args = [
      "logs",
      `daemonset/${tab.target.name}`,
      "--namespace",
      tab.target.namespace,
      "--all-containers=true",
      "--tail=500",
      "--request-timeout=8s",
    ];

    if (tab.logsPrevious) args.push("--previous");
    if (tab.logsSelectedContainer !== "__all__") {
      args.push("-c", tab.logsSelectedContainer);
    }

    try {
      const response = await kubectlRawArgsFront(args, { clusterId: data.slug });
      if (response.errors || response.code !== 0) {
        throw new Error(response.errors || "Failed to load daemon set logs.");
      }
      updateLogsTab(tabId, (current) => ({
        ...current,
        logsLoading: false,
        logsError: null,
        logsText: response.output || "",
        logsUpdatedAt: Date.now(),
      }));
    } catch (error) {
      updateLogsTab(tabId, (current) => ({
        ...current,
        logsLoading: false,
        logsError: error instanceof Error ? error.message : "Failed to load daemon set logs.",
      }));
    }
  }

  async function openLogsForDaemonSet(item: DaemonSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name || !data?.slug) return;

    const tabId = `logs:${namespace}/${name}`;
    const existing = getLogsTab(tabId);

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
          logsContainerOptions: ["__all__"],
          logsSelectedContainer: "__all__",
          bookmarks: [],
        },
      ];
    } else {
      updateLogsTab(tabId, (current) => ({
        ...current,
        target: { name, namespace },
        logsText: "",
        logsError: null,
        logsSelectedContainer: "__all__",
        logsContainerOptions: ["__all__"],
        logsPrevious: false,
        bookmarks: [],
      }));
    }

    upsertWorkbenchTab({
      id: tabId,
      kind: "logs",
      title: `Logs ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    await loadLogsForTab(tabId);
    startLiveLogsForTab(tabId);
  }

  async function refreshYamlForTab(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!tab || !data?.slug) return;

    updateYamlTab(tabId, (current) => ({ ...current, yamlLoading: true, yamlError: null }));

    try {
      const response = await kubectlRawArgsFront(
        ["get", "daemonset", tab.target.name, "--namespace", tab.target.namespace, "-o", "yaml"],
        { clusterId: data.slug },
      );
      if (response.errors || response.code !== 0) {
        throw new Error(response.errors || "Failed to load daemon set YAML.");
      }

      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlLoading: false,
        yamlError: null,
        yamlText: response.output || "",
        yamlOriginalText: response.output || "",
      }));
    } catch (error) {
      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlLoading: false,
        yamlError: error instanceof Error ? error.message : "Failed to load daemon set YAML.",
      }));
    }
  }

  async function openYamlForDaemonSet(item: DaemonSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name || !data?.slug) return;

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
      updateYamlTab(tabId, (current) => ({
        ...current,
        target: { name, namespace },
        yamlLoading: true,
        yamlError: null,
      }));
    }

    upsertWorkbenchTab({
      id: tabId,
      kind: "yaml",
      title: `YAML ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    await refreshYamlForTab(tabId);
  }

  async function openEventsForDaemonSet(item: DaemonSetItem) {
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

    upsertWorkbenchTab({
      id: tabId,
      kind: "events",
      title: `Events ${name}`,
      subtitle: namespace,
    });
    workbenchCollapsed = false;
    workbenchFullscreen = false;
    try {
      const events = await loadWorkloadEvents(data.slug, {
        resource: "daemonset",
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
        eventsError: error instanceof Error ? error.message : "Failed to load daemon set events.",
      }));
    }
  }

  async function openRolloutCommandForDaemonSet(mode: RolloutCommandMode, item: DaemonSetItem) {
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
        resource: "daemonset",
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

  async function saveDaemonSetYaml(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!data?.slug || !tab) return;

    updateYamlTab(tabId, (current) => ({ ...current, yamlSaving: true, yamlError: null }));
    const relativePath = `tmp/daemonset-edit-${tab.target.namespace}-${tab.target.name}-${Date.now()}.yaml`;

    try {
      await mkdir("tmp", { recursive: true, baseDir: BaseDirectory.AppData });
      await writeTextFile(relativePath, tab.yamlText, { baseDir: BaseDirectory.AppData });
      const appDataPath = await path.appDataDir();
      const absolutePath = await path.join(appDataPath, relativePath);
      const response = await kubectlRawArgsFront(["apply", "-f", absolutePath], { clusterId: data.slug });

      if (response.errors || response.code !== 0) {
        throw new Error(response.errors || "Failed to apply daemon set YAML.");
      }

      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlSaving: false,
        yamlOriginalText: current.yamlText,
      }));
      actionNotification = notifySuccess(`Applied YAML: ${tab.target.namespace}/${tab.target.name}`);
      invalidateDaemonSetsSnapshotCache();
      mutationReconcile.schedule();
    } catch (error) {
      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlSaving: false,
        yamlError: error instanceof Error ? error.message : "Failed to apply daemon set YAML.",
      }));
    } finally {
      try {
        await remove(relativePath, { baseDir: BaseDirectory.AppData });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
  }

  async function openDaemonSetInvestigationWorkspace(item: DaemonSetItem) {
    const name = item.metadata?.name;
    const namespace = item.metadata?.namespace ?? "default";
    if (!name) return;

    const logsTabId = `logs:${namespace}/${name}`;
    const yamlTabId = `yaml:${namespace}/${name}`;
    await openLogsForDaemonSet(item);
    await openYamlForDaemonSet(item);
    setWorkbenchLayout("dual");
    assignTabToPane(0, logsTabId);
    assignTabToPane(1, yamlTabId);
    assignTabToPane(2, null);
    setActiveWorkbenchTab(logsTabId);
  }

  function clearActionFeedback() {
    actionNotification = null;
    yamlDownloadError = null;
    yamlDownloadMessage = null;
  }

  function invalidateDaemonSetsSnapshotCache() {
    invalidateWorkloadSnapshotCache(data?.slug, "daemonsets");
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

  async function copyDescribeCommandForDaemonSet(item: DaemonSetItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    const command = buildKubectlDescribeCommand({
      resource: "daemonsets",
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

  function openDebugDescribeForDaemonSet(item: DaemonSetItem) {
    const name = item.metadata?.name;
    if (!name) return;
    const namespace = item.metadata?.namespace ?? "default";
    runDebugDescribe({
      clusterId: data.slug,
      resource: "daemonset",
      name,
      namespace,
      title: `Describe daemonset ${namespace}/${name}`,
    });
    actionNotification = notifySuccess(`Opened debug describe for ${namespace}/${name}.`);
    actionNotification = null;
  }

  async function downloadYamlForDaemonSets(items: DaemonSetItem[]) {
    if (!data?.slug || items.length === 0) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["get", "daemonset", name, "--namespace", namespace, "-o", "yaml"],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to download YAML for ${namespace}/${name}.`);
        }
        const filename = buildYamlFilename("daemonset", namespace, name);
        await writeTextFile(filename, response.output || "", { baseDir: BaseDirectory.Download });
      }
      if (items.length === 1) {
        const only = items[0];
        const onlyName = only.metadata?.name ?? "daemonset";
        const onlyNs = only.metadata?.namespace ?? "default";
        yamlDownloadMessage = `YAML exported ~/Downloads: ${buildYamlFilename("daemonset", onlyNs, onlyName)}`;
      } else {
        yamlDownloadMessage = `YAML exported ~/Downloads: ${items.length} files.`;
      }
    } catch (error) {
      yamlDownloadError = error instanceof Error ? error.message : "Failed to download YAML.";
    } finally {
      actionInFlight = false;
    }
  }

  async function restartDaemonSets(items: DaemonSetItem[]) {
    if (!data?.slug || items.length === 0) return;
    clearActionFeedback();
    actionInFlight = true;
    try {
      for (const item of items) {
        const name = item.metadata?.name;
        const namespace = item.metadata?.namespace ?? "default";
        if (!name) continue;
        const response = await kubectlRawArgsFront(
          ["rollout", "restart", `daemonset/${name}`, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to restart ${namespace}/${name}.`);
        }
      }
      actionNotification = notifySuccess(`Rollout restart executed for ${items.length} daemonset${items.length === 1 ? "" : "s"}.`);
      invalidateDaemonSetsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["MODIFIED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to restart daemonsets.");
    } finally {
      actionInFlight = false;
    }
  }

  async function deleteDaemonSets(items: DaemonSetItem[]) {
    if (!data?.slug || items.length === 0) return;
    const confirmed = await confirmAction(
      `Delete ${items.length} daemonset${items.length === 1 ? "" : "s"}? This cannot be undone.`,
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
          ["delete", "daemonset", name, "--namespace", namespace],
          { clusterId: data.slug },
        );
        if (response.errors || response.code !== 0) {
          throw new Error(response.errors || `Failed to delete ${namespace}/${name}.`);
        }
      }
      selectedDaemonSetIds = new Set<string>();
      removeDaemonSetsFromSnapshot(items);
      actionNotification = notifySuccess(`Deleted ${items.length} daemonset${items.length === 1 ? "" : "s"}.`);
      invalidateDaemonSetsSnapshotCache();
      mutationReconcile.track({
        ids: items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
        expectedEventTypes: ["DELETED"],
      });
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to delete daemonsets.");
    } finally {
      actionInFlight = false;
    }
  }

  function getDetailsHeaderNode() {
    if (detailsPods.length > 0 && detailsPods[0]?.node) return detailsPods[0].node;
    const templateSpec = $selectedItem?.spec?.template?.spec as
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

  function isDaemonSetSelected(id: string) {
    return selectedDaemonSetIds.has(id);
  }

  function toggleDaemonSetSelection(id: string, next?: boolean) {
    if (!id) return;
    const shouldSelect = typeof next === "boolean" ? next : !selectedDaemonSetIds.has(id);
    const updated = new Set(selectedDaemonSetIds);
    if (shouldSelect) updated.add(id);
    else updated.delete(id);
    selectedDaemonSetIds = updated;
  }

  function toggleAllSelection(next?: boolean) {
    if (availableIds.length === 0) {
      selectedDaemonSetIds = new Set<string>();
      return;
    }
    const shouldSelectAll =
      typeof next === "boolean" ? next : availableIds.some((id) => !selectedDaemonSetIds.has(id));
    selectedDaemonSetIds = shouldSelectAll ? new Set(availableIds) : new Set<string>();
  }

  function toggleGroupSelection(_groupKey: string, next: boolean, rowIds: string[]) {
    const updated = new Set(selectedDaemonSetIds);
    if (next) {
      rowIds.forEach((id) => updated.add(id));
    } else {
      rowIds.forEach((id) => updated.delete(id));
    }
    selectedDaemonSetIds = updated;
  }

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

  function loadWorkbenchState(clusterId: string): PersistedDaemonSetsWorkbenchState | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(getDaemonSetsWorkbenchStateKey(clusterId));
      return parseDaemonSetsWorkbenchState(raw);
    } catch {
      return null;
    }
  }

  function clearWorkbenchState(clusterId: string) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(getDaemonSetsWorkbenchStateKey(clusterId));
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
        } satisfies PersistedDaemonSetsWorkbenchTab;
      })
      .filter((tab): tab is PersistedDaemonSetsWorkbenchTab => Boolean(tab));

    const payload: PersistedDaemonSetsWorkbenchState = {
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
        getDaemonSetsWorkbenchStateKey(data.slug),
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
      viewMode: daemonSetsTableViewMode,
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

  function bindDaemonSetsSyncStore(clusterId: string) {
    daemonSetsSyncStoreUnsubscribe?.();
    daemonSetsSyncStoreUnsubscribe = selectClusterDaemonSets(clusterId).subscribe((items) => {
      daemonSetsSnapshot = items as DaemonSetItem[];
      lastWatcherSuccessAt = Date.now();
    });
  }

  async function refreshDaemonSetsFromWatcher(source: "manual" | "watcher" = "watcher") {
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
    markDaemonSetsSyncLoading(data.slug);
    try {
      daemonSetsSnapshot = await fetchNamespacedSnapshotItems<DaemonSetItem>({
        clusterId: data.slug,
        selectedNamespace: $selectedNamespace,
        resource: "daemonsets",
        errorMessage: "DaemonSets watcher sync failed.",
      });
      lastWatcherSuccessAt = Date.now();
      markDaemonSetsSyncSuccess(data.slug);
    } catch (error) {
      const message = error instanceof Error ? error.message : "DaemonSets watcher sync failed.";
      watcherError = message;
      markDaemonSetsSyncError(data.slug, message);
    } finally {
      watcherInFlight = false;
    }
  }

  function applyWatcherMode() {
    if (!data?.slug) return;
    if (watcherPolicy.enabled) {
      setDaemonSetsSyncEnabled(data.slug, true);
      if (watcherPolicy.mode === "stream") {
        stopWatcherTimer();
        bindDaemonSetsSyncStore(data.slug);
        initDaemonSetsSync(data.slug, Array.isArray(data.daemonsets) ? data.daemonsets : []);
        daemonSetsSyncStarted = true;
      } else {
        if (daemonSetsSyncStarted) {
          destroyDaemonSetsSync(data.slug);
          daemonSetsSyncStarted = false;
        }
        startWatcherTimer();
      }
      void refreshDaemonSetsFromWatcher();
      return;
    }
    setDaemonSetsSyncEnabled(data.slug, false);
    stopWatcherTimer();
    if (daemonSetsSyncStarted) {
      destroyDaemonSetsSync(data.slug);
      daemonSetsSyncStarted = false;
    }
  }

  function removeDaemonSetsFromSnapshot(items: DaemonSetItem[]) {
    const keys = new Set(
      items.map((item) => `${item.metadata?.namespace ?? "default"}/${item.metadata?.name ?? ""}`),
    );
    if (watcherPolicy.mode === "stream" && data?.slug) {
      for (const item of items) {
        applyDaemonSetEvent(data.slug, { type: "DELETED", object: item });
      }
      return;
    }
    daemonSetsSnapshot = daemonSetsSnapshot.filter((item) => {
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

  function setViewMode(mode: DaemonSetsTableViewMode) {
    daemonSetsTableViewMode = mode;
    persistWatcherSettings();
  }

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    daemonSetsTableViewMode = DEFAULT_WATCHER_SETTINGS.viewMode;
    persistWatcherSettings();
    applyWatcherMode();
  }

  $effect(() => {
    if (!data?.slug) return;
    setInitialDaemonSets(data.slug, data.daemonsets ?? []);
    if (watcherPolicy.mode !== "stream") {
      daemonSetsSnapshot = data.daemonsets ?? [];
    }
  });

  $effect(() => {
    const nextSelection = pruneSelectedDaemonSetIds(selectedDaemonSetIds, availableIds);
    if (nextSelection !== selectedDaemonSetIds) {
      selectedDaemonSetIds = nextSelection;
    }
  });

  $effect(() => {
    if (!$isSheetOpen || !$selectedItem) return;
    const key = toActiveDetailsKey();
    if (!key) return;
    if (detailsKeyLoaded === key) return;
    void loadDetailsData();
  });

  $effect(() => {
    if (workbenchStateRestored) return;
    if (pendingWorkbenchState === undefined) return;
    if (!pendingWorkbenchState) {
      workbenchStateRestored = true;
      return;
    }
    if (daemonSetsSnapshot.length === 0) return;

    const state = pendingWorkbenchState;
    pendingWorkbenchState = null;

    const tabsToOpen = state.tabs
      .map((tab) => {
        const daemonSet = daemonSetsSnapshot.find(
          (item) =>
            item.metadata?.name === tab.name &&
            (item.metadata?.namespace ?? "default") === tab.namespace,
        );
        return daemonSet ? { tab, daemonSet } : null;
      })
      .filter((entry): entry is { tab: PersistedDaemonSetsWorkbenchTab; daemonSet: DaemonSetItem } =>
        Boolean(entry),
      );

    for (const entry of tabsToOpen) {
      if (entry.tab.kind === "logs") {
        void openLogsForDaemonSet(entry.daemonSet);
      } else if (entry.tab.kind === "yaml") {
        void openYamlForDaemonSet(entry.daemonSet);
      } else if (entry.tab.kind === "events") {
        void openEventsForDaemonSet(entry.daemonSet);
      } else {
        void openRolloutCommandForDaemonSet(
          entry.tab.kind === "rollout-status" ? "status" : "history",
          entry.daemonSet,
        );
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
      if (activeWorkbenchTabId !== null) activeWorkbenchTabId = null;
      if (workbenchCollapsed) workbenchCollapsed = false;
      if (workbenchFullscreen) workbenchFullscreen = false;
      if (workbenchLayout !== "single") workbenchLayout = "single";
      setPaneTabIdsIfChanged([null, null, null]);
      setCollapsedPaneIndexesIfChanged([]);
      if (pinnedTabIds.size > 0) pinnedTabIds = new Set<string>();
      if (closedWorkbenchTabs.length > 0) closedWorkbenchTabs = [];
      if (yamlCompareSourceTabId !== null) yamlCompareSourceTabId = null;
      if (yamlComparePair !== null) yamlComparePair = null;
      if (yamlCompareTargetTabId !== null) yamlCompareTargetTabId = null;
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

  $effect(() => {
    const clusterId = data?.slug ?? null;
    if (!clusterId) return;
    if (watcherSettingsLoadedCluster === clusterId) return;

    const previousClusterId = watcherSettingsLoadedCluster;
    if (previousClusterId) {
      setDaemonSetsSyncEnabled(previousClusterId, false);
      resetDaemonSetsSyncStatus(previousClusterId);
      if (daemonSetsSyncStarted) {
        destroyDaemonSetsSync(previousClusterId);
        daemonSetsSyncStarted = false;
      }
      daemonSetsSyncStoreUnsubscribe?.();
      daemonSetsSyncStoreUnsubscribe = null;
    }

    const settings = loadWatcherSettings(clusterId);
    watcherEnabled = settings.enabled;
    watcherRefreshSeconds = settings.refreshSeconds;
    daemonSetsTableViewMode = settings.viewMode;
    watcherSettingsLoadedCluster = clusterId;
    applyWatcherMode();
  });

  onMount(() => {
    const runtimeClockTimer = setInterval(() => {
      runtimeClockNow = Date.now();
    }, 5_000);
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

  onDestroy(() => {
    persistWorkbenchState();
    detailsActions.abortAll();
    stopWatcherTimer();
    mutationReconcile.clearScope();
    daemonSetsSyncStoreUnsubscribe?.();
    daemonSetsSyncStoreUnsubscribe = null;
    stopAllLiveLogs();
    if (!data?.slug) return;
    destroyDaemonSetsSync(data.slug);
    resetDaemonSetsSyncStatus(data.slug);
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />
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
                  void saveDaemonSetYaml(currentYamlTab.id);
                }}
              />
            {:else if activeWorkbenchTab.kind === "events"}
              {@const currentEventsTab = getEventsTab(activeWorkbenchTab.id)}
              <WorkloadEventsSheet
                embedded={true}
                isOpen={workbenchOpen}
                title={`Daemon set events: ${currentEventsTab ? `${currentEventsTab.target.namespace}/${currentEventsTab.target.name}` : "-"}`}
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
                        resource: "daemonset",
                        name: currentRolloutTab.target.name,
                        namespace: currentRolloutTab.target.namespace,
                      }).join(" ")
                    : null
                }
                output={currentRolloutTab?.output ?? ""}
                loading={currentRolloutTab?.loading ?? false}
                error={currentRolloutTab?.error ?? null}
                onRefresh={() => {
                  const daemonSet = currentRolloutTab ? findDaemonSetItem(daemonSetsSnapshot, {
                    uid: `${currentRolloutTab.target.namespace}/${currentRolloutTab.target.name}`,
                    name: currentRolloutTab.target.name,
                    namespace: currentRolloutTab.target.namespace,
                  } as DaemonSetRow) : null;
                  if (!currentRolloutTab || !daemonSet) return;
                  void openRolloutCommandForDaemonSet(currentRolloutTab.mode, daemonSet);
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
                            void saveDaemonSetYaml(paneYamlTab.id);
                          }}
                        />
                      {/if}
                    {:else if paneTab.kind === "events"}
                      {@const paneEventsTab = getEventsTab(paneTab.id)}
                      {#if paneEventsTab}
                        <WorkloadEventsSheet
                          embedded={true}
                          isOpen={workbenchOpen}
                          title={`Daemon set events: ${paneEventsTab.target.namespace}/${paneEventsTab.target.name}`}
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
                            resource: "daemonset",
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
                            const daemonSet = findDaemonSetItem(daemonSetsSnapshot, {
                              uid: `${paneRolloutTab.target.namespace}/${paneRolloutTab.target.name}`,
                              name: paneRolloutTab.target.name,
                              namespace: paneRolloutTab.target.namespace,
                            } as DaemonSetRow);
                            if (!daemonSet) return;
                            void openRolloutCommandForDaemonSet(paneRolloutTab.mode, daemonSet);
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
                              void saveDaemonSetYaml(paneYamlTab.id);
                            }}
                          />
                        {/if}
                      {:else if paneTab.kind === "events"}
                        {@const paneEventsTab = getEventsTab(paneTab.id)}
                        {#if paneEventsTab}
                          <WorkloadEventsSheet
                            embedded={true}
                            isOpen={workbenchOpen}
                            title={`Daemon set events: ${paneEventsTab.target.namespace}/${paneEventsTab.target.name}`}
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
                              resource: "daemonset",
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
                              const daemonSet = findDaemonSetItem(daemonSetsSnapshot, {
                                uid: `${paneRolloutTab.target.namespace}/${paneRolloutTab.target.name}`,
                                name: paneRolloutTab.target.name,
                                namespace: paneRolloutTab.target.namespace,
                              } as DaemonSetRow);
                              if (!daemonSet) return;
                              void openRolloutCommandForDaemonSet(paneRolloutTab.mode, daemonSet);
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
    </div>
  {/if}

  {#if selectedCount > 0}
    <WorkloadSelectionBar count={selectedCount}>
      {#snippet children()}
        <DaemonSetBulkActions
          mode={selectedCount === 1 ? "single" : "multi"}
          disabled={actionInFlight}
          onShowDetails={() => {
            if (selectedDaemonSets.length !== 1) return;
            openSheet(selectedDaemonSets[0]);
          }}
          onLogs={() => {
            if (selectedDaemonSets.length !== 1) return;
            void openLogsForDaemonSet(selectedDaemonSets[0]);
          }}
          onEvents={() => {
            if (selectedDaemonSets.length !== 1) return;
            void openEventsForDaemonSet(selectedDaemonSets[0]);
          }}
          onEditYaml={() => {
            if (selectedDaemonSets.length !== 1) return;
            void openYamlForDaemonSet(selectedDaemonSets[0]);
          }}
          onInvestigate={() => {
            if (selectedDaemonSets.length !== 1) return;
            void openDaemonSetInvestigationWorkspace(selectedDaemonSets[0]);
          }}
          onCopyDescribe={() => {
            if (selectedDaemonSets.length !== 1) return;
            void copyDescribeCommandForDaemonSet(selectedDaemonSets[0]);
          }}
          onRunDebugDescribe={() => {
            if (selectedDaemonSets.length !== 1) return;
            openDebugDescribeForDaemonSet(selectedDaemonSets[0]);
          }}
          onDownloadYaml={() => {
            void downloadYamlForDaemonSets(selectedDaemonSets);
          }}
          onRolloutStatus={() => {
            if (selectedDaemonSets.length !== 1) return;
            void openRolloutCommandForDaemonSet("status", selectedDaemonSets[0]);
          }}
          onRolloutHistory={() => {
            if (selectedDaemonSets.length !== 1) return;
            void openRolloutCommandForDaemonSet("history", selectedDaemonSets[0]);
          }}
          onRestart={() => {
            void restartDaemonSets(selectedDaemonSets);
          }}
          onDelete={() => {
            void deleteDaemonSets(selectedDaemonSets);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={actionInFlight}
          onclick={() => {
            selectedDaemonSetIds = new Set<string>();
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
      { label: "Namespace", value: daemonSetsNamespaceSummary },
      { label: "Daemon Sets", value: rows.length },
      { label: "Sync", value: daemonSetsRuntimeSourceState },
    ]}
    trailingItem={{
      label: "View",
      value: daemonSetsSummaryView,
      valueClass: "text-foreground",
    }}
  />

  <div class="mb-4">
    <SectionRuntimeStatus
      sectionLabel="Daemon Sets Runtime Status"
      profileLabel={daemonSetsRuntimeProfileLabel}
      sourceState={daemonSetsRuntimeSourceState}
      mode={watcherPolicy.mode === "stream" ? "stream" : "poll"}
      budgetSummary={`sync ${watcherPolicy.refreshSeconds}s`}
      lastUpdatedLabel={daemonSetsRuntimeLastUpdatedLabel}
      detail={daemonSetsRuntimeDetail}
      secondaryActionLabel="Update"
      secondaryActionAriaLabel="Refresh daemon sets runtime section"
      secondaryActionLoading={watcherInFlight}
      onSecondaryAction={() => void refreshDaemonSetsFromWatcher("manual")}
      reason={daemonSetsRuntimeReason}
      actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
      actionAriaLabel={watcherEnabled ? "Pause daemon sets runtime section" : "Resume daemon sets runtime section"}
      onAction={toggleWatcher}
    />
  </div>

  <DataTable
    data={rows}
    {columns}
    isRowSelected={(row) => isDaemonSetSelected(row.uid)}
    onToggleGroupSelection={toggleGroupSelection}
    {watcherEnabled}
    {watcherRefreshSeconds}
    {watcherError}
    viewMode={daemonSetsTableViewMode}
    onViewModeChange={setViewMode}
    onToggleWatcher={toggleWatcher}
    onWatcherRefreshSecondsChange={setWatcherRefreshSeconds}
    onResetWatcherSettings={resetWatcherSettings}
    onCsvDownloaded={({ pathHint, rows: csvRows }) => {
      actionNotification = null;
      actionNotification = notifySuccess(`CSV exported: ${pathHint} (${csvRows} rows).`);
    }}
    onRowClick={(row) => {
      const item = findDaemonSetItem(daemonSets, row);
      if (item) openSheet(item);
    }}
  />

  {#if $isSheetOpen && $selectedItem}
  <DetailsSheetPortal open={$isSheetOpen} onClose={closeDetails} closeAriaLabel="Close daemon set details">
        <div class="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div class="min-w-0 flex items-center gap-2">
            <Info class="h-4 w-4 shrink-0 text-muted-foreground" />
            <div class="truncate text-base font-semibold">DaemonSet: {$selectedItem.metadata?.name ?? "-"}</div>
          </div>
          <DetailsHeaderActions
            actions={[
              {
                id: "download-yaml",
                title: "Download YAML",
                ariaLabel: "Download daemon set YAML",
                icon: FileDown,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => downloadYamlForDaemonSets([item]));
                },
              },
              {
                id: "logs",
                title: "Logs",
                ariaLabel: "Open daemon set logs",
                icon: ScrollText,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openLogsForDaemonSet(item));
                },
              },
              {
                id: "events",
                title: "Events",
                ariaLabel: "Open daemon set events",
                icon: Clock3,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openEventsForDaemonSet(item));
                },
              },
              {
                id: "edit-yaml",
                title: "Edit YAML",
                ariaLabel: "Edit daemon set YAML",
                icon: Pencil,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openYamlForDaemonSet(item));
                },
              },
              {
                id: "restart",
                title: "Rollout restart",
                ariaLabel: "Rollout restart daemon set",
                icon: RotateCcw,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => restartDaemonSets([item]));
                },
              },
              {
                id: "rollout-status",
                title: "Rollout status",
                ariaLabel: "Open rollout status for daemon set",
                icon: Clock3,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openRolloutCommandForDaemonSet("status", item));
                },
              },
              {
                id: "rollout-history",
                title: "Rollout history",
                ariaLabel: "Open rollout history for daemon set",
                icon: ListTree,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openRolloutCommandForDaemonSet("history", item));
                },
              },
              {
                id: "investigate",
                title: "Investigate",
                ariaLabel: "Investigate daemon set",
                icon: Search,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => openDaemonSetInvestigationWorkspace(item));
                },
              },
              {
                id: "copy-describe",
                title: "Copy kubectl describe",
                ariaLabel: "Copy kubectl describe for daemon set",
                icon: ClipboardList,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => copyDescribeCommandForDaemonSet(item));
                },
              },
              {
                id: "delete",
                title: "Delete",
                ariaLabel: "Delete daemon set",
                icon: Trash,
                destructive: true,
                onClick: () => {
                  const item = $selectedItem;
                  if (!item) return;
                  void runDetailsAction(() => deleteDaemonSets([item]));
                },
              },
            ]}
            closeAriaLabel="Close details"
            onClose={closeDetails}
          />
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <div class="text-xs text-muted-foreground">
            Namespace: {$selectedItem.metadata?.namespace ?? "default"} · Node: {getDetailsHeaderNode()} · Pod IP:
            {getDetailsHeaderPodIp()}
          </div>
          <ResourceTrafficChain
            clusterId={data.slug}
            resourceKind="DaemonSet"
            resourceName={$selectedItem.metadata?.name ?? ""}
            resourceNamespace={$selectedItem.metadata?.namespace ?? "default"}
            raw={$selectedItem as unknown as Record<string, unknown>}
          />
          <h3 class="my-4 font-bold">Properties</h3>
          <DetailsMetadataGrid
            contextKey={`${$selectedItem.metadata?.namespace ?? "default"}/${$selectedItem.metadata?.name ?? "-"}`}
            fields={[
              { label: "Created", value: formatCreatedLabel() },
              { label: "Name", value: $selectedItem.metadata?.name ?? "-" },
              { label: "Namespace", value: $selectedItem.metadata?.namespace ?? "default" },
            ]}
            labels={getLabelEntries()}
            annotations={getAnnotationEntries()}
          />
          <div class="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Selector</div>
              <div class="break-all">{getSelectorLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Node Selector</div>
              <div class="break-all">{getNodeSelectorLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Images</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showImagesDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showImagesDetails = !showImagesDetails)}
              >
                <span>{getImages().length} Image{getImages().length === 1 ? "" : "s"}</span>
                {#if showImagesDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showImagesDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getImages().length === 0}
                    <div class="text-muted-foreground">No images found.</div>
                  {:else}
                    {#each getImages() as image}
                      <div class="break-all">{image}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Strategy Type</div>
              <div>{getStrategyType()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Tolerations</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showTolerationsDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showTolerationsDetails = !showTolerationsDetails)}
              >
                <span>{getTolerationsCount()}</span>
                {#if showTolerationsDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showTolerationsDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getTolerationDetails().length === 0}
                    <div class="text-muted-foreground">No tolerations.</div>
                  {:else}
                    {#each getTolerationDetails() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Pod Status</div>
              <div>{getPodStatusLabel()}</div>
            </div>
            <div class="rounded border p-3">
              <div class="text-xs text-muted-foreground">Node Affinities</div>
              <button
                type="button"
                class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-1 text-left transition ${
                  showNodeAffinitiesDetails
                    ? "bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onclick={() => (showNodeAffinitiesDetails = !showNodeAffinitiesDetails)}
              >
                <span>{getNodeAffinityRulesCount()} Rule{getNodeAffinityRulesCount() === 1 ? "" : "s"}</span>
                {#if showNodeAffinitiesDetails}
                  <ChevronUp class="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
                {:else}
                  <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
                {/if}
              </button>
              {#if showNodeAffinitiesDetails}
                <div class="mt-2 space-y-1 rounded border border-sky-200/60 bg-sky-50/70 p-2 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
                  {#if getNodeAffinityDetails().length === 0}
                    <div class="text-muted-foreground">No node affinity rules.</div>
                  {:else}
                    {#each getNodeAffinityDetails() as line}
                      <div class="break-all">{line}</div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </div>
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
          <DetailsEventsList events={detailsEvents} emptyText="No events found." />
          {#if detailsLoading}
            <div class="mt-3 text-sm text-muted-foreground">Loading daemon set details...</div>
          {/if}
          {#if detailsError}
            <div class="mt-3 rounded border border-rose-300/80 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/70 dark:bg-rose-500/20 dark:text-rose-100">
              {detailsError}
            </div>
          {/if}
        </div>
  </DetailsSheetPortal>
  {/if}
