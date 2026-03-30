<script lang="ts">
  import ActionNotificationBar from "$shared/ui/action-notification-bar.svelte";
  import { onDestroy, onMount } from "svelte";
  import { writable, readable, type Readable } from "svelte/store";
  import { path } from "@tauri-apps/api";
  import { BaseDirectory, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
  import GitCompareArrows from "@lucide/svelte/icons/git-compare-arrows";
  import Target from "@lucide/svelte/icons/target";
  import X from "@lucide/svelte/icons/x";

  import { resolvePageClusterName, type PageData } from "$entities/cluster";
  import type { NodeItem } from "$shared/model/clusters";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { buildKubectlDescribeCommand } from "$features/workloads-management";
  import { runDebugDescribe } from "$features/resource-debug-runtime";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { getTimeDifference } from "$shared";
  import * as Alert from "$shared/ui/alert";
  import { Button } from "$shared/ui/button";
  import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";
  import {
    computeLayoutClosePlan,
    orderPinnedTabs,
  } from "$features/pods-workbench";

  import type { NodeHealth } from "$features/check-health";
  import {
    clearNodesAge,
    destroyNodesSync,
    getNodeCreatedAt,
    getLastHealthCheck,
    initNodesSync,
    refreshNodesHealthNow,
    selectClusterNodes,
    selectClusterNodesHealth,
    startNodesHealthPolling,
    stopNodesHealthPolling,
    upsertNodesAge,
  } from "$features/check-health";

  import DataTable from "./data-table.svelte";
  import DataSheet from "./data-sheet.svelte";
  import NodeBulkActions from "./node-bulk-actions.svelte";
  import ResourceYamlSheet from "../common/resource-yaml-sheet.svelte";
  import { createColumns, type NodesStatusesData } from "./columns";
  import { buildNodeProblemSignals } from "../model/problem-priority";
  import {
    buildMetricsRecommendationText,
    buildMetricsSourcesHref,
    hasCoreMetricsSourcesUnavailableByChecks,
    hasCoreMetricsSourcesUnavailable,
    METRICS_BANNER_CTA,
    METRICS_BANNER_DISK_NOTE,
    METRICS_BANNER_PIPELINE,
    METRICS_BANNER_SUMMARY,
  } from "../common/metrics-banner-copy";
  import { runMetricsSourcesCheck, type MetricsSourceCheck } from "$features/metrics-sources";
  import {
    dashboardDataProfile,
    getDashboardDataProfileDisplayName,
    resolveCoreResourceSyncPolicy,
    resolveDerivedRefreshPolicy,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import ResourceSummaryStrip from "../common/resource-summary-strip.svelte";
  import SectionRuntimeStatus from "../common/section-runtime-status.svelte";
  import WorkloadSelectionBar from "../common/workload-selection-bar.svelte";
  import {
    confirmWorkbenchLayoutShrink,
    confirmWorkbenchTabClose,
  } from "../common/workbench-confirm";

  interface NodesStatusListProps {
    data: PageData & { nodes?: NodeItem[] };
  }

  const { data }: NodesStatusListProps = $props();

  type WatcherSettings = {
    enabled: boolean;
    refreshSeconds: number;
  };

  type NodesHealthState = {
    enabled: boolean;
    data: NodeHealth[];
    isLoading: boolean;
    error: string | null;
    lastUpdatedAt: number | null;
  };

  type WorkbenchLayout = "single" | "dual" | "triple";
  type WorkbenchTab = {
    id: string;
    kind: "yaml";
    title: string;
    subtitle: string;
  };
  type ClosedWorkbenchTab = {
    kind: "yaml";
    target: { name: string } | null;
    pinned: boolean;
  };
  type YamlTabState = {
    id: string;
    target: { name: string };
    yamlLoading: boolean;
    yamlSaving: boolean;
    yamlError: string | null;
    yamlText: string;
    yamlOriginalText: string;
  };

  const WATCHER_SETTINGS_PREFIX = "dashboard.nodes-status.watcher.settings.v1";
  const DEFAULT_WATCHER_SETTINGS: WatcherSettings = {
    enabled: true,
    refreshSeconds: 20,
  };

  let clusterId = $state("");
  $effect(() => {
    clusterId = data.slug;
  });

  const emptyNodesStore: Readable<Partial<NodeItem>[]> = readable([]);
  const emptyHealthStore: Readable<NodesHealthState> = readable({
    enabled: false,
    data: [],
    isLoading: false,
    error: null,
    lastUpdatedAt: null,
  });

  let clusterNodes: Readable<Partial<NodeItem>[]> = $state(emptyNodesStore);
  let clusterHealth: Readable<NodesHealthState> = $state(emptyHealthStore);

  $effect(() => {
    if (!clusterId) return;
    clusterNodes = selectClusterNodes(clusterId);
    clusterHealth = selectClusterNodesHealth(clusterId);
  });

  function getWatcherStorageKey(clusterKey: string) {
    return `${WATCHER_SETTINGS_PREFIX}:${clusterKey}`;
  }

  function loadWatcherSettings(clusterKey: string): WatcherSettings {
    if (typeof window === "undefined") return DEFAULT_WATCHER_SETTINGS;
    try {
      const raw = window.localStorage.getItem(getWatcherStorageKey(clusterKey));
      if (!raw) return DEFAULT_WATCHER_SETTINGS;
      const parsed = JSON.parse(raw) as Partial<WatcherSettings>;
      const enabled =
        typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_WATCHER_SETTINGS.enabled;
      const secondsRaw = Number(parsed.refreshSeconds);
      const refreshSeconds =
        Number.isFinite(secondsRaw) && secondsRaw >= 5
          ? Math.min(600, Math.max(5, Math.round(secondsRaw)))
          : DEFAULT_WATCHER_SETTINGS.refreshSeconds;
      return { enabled, refreshSeconds };
    } catch {
      return DEFAULT_WATCHER_SETTINGS;
    }
  }

  function saveWatcherSettings(clusterKey: string) {
    if (typeof window === "undefined") return;
    const payload: WatcherSettings = {
      enabled: watcherEnabled,
      refreshSeconds: watcherRefreshSeconds,
    };
    window.localStorage.setItem(getWatcherStorageKey(clusterKey), JSON.stringify(payload));
  }

  let watcherEnabled = $state(DEFAULT_WATCHER_SETTINGS.enabled);
  let watcherRefreshSeconds = $state(DEFAULT_WATCHER_SETTINGS.refreshSeconds);
  let watcherError = $state<string | null>(null);
  let watcherSettingsLoadedCluster = $state<string | null>(null);
  const nodesResourceSyncPolicy = $derived.by(() =>
    resolveCoreResourceSyncPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
      supportsStream: true,
      supportsPollingFallback: false,
    }),
  );
  const nodesDerivedRefreshPolicy = $derived.by(() =>
    resolveDerivedRefreshPolicy($dashboardDataProfile, {
      userEnabled: watcherEnabled,
      requestedRefreshSeconds: watcherRefreshSeconds,
    }),
  );
  const nodesAutoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  $effect(() => {
    if (!clusterId) return;
    if (watcherSettingsLoadedCluster === clusterId) return;
    const settings = loadWatcherSettings(clusterId);
    watcherEnabled = settings.enabled;
    watcherRefreshSeconds = settings.refreshSeconds;
    watcherSettingsLoadedCluster = clusterId;
  });

  $effect(() => {
    if (!clusterId) return;
    if (data?.nodes?.length) upsertNodesAge(data.nodes);
    if (nodesResourceSyncPolicy.enabled && nodesResourceSyncPolicy.mode === "stream") {
      initNodesSync(clusterId, data.nodes ?? []);
    }
    return () => {
      destroyNodesSync(clusterId);
      clearNodesAge();
    };
  });

  $effect(() => {
    if (!clusterId) return;
    if (nodesDerivedRefreshPolicy.enabled) {
      startNodesHealthPolling(clusterId, nodesDerivedRefreshPolicy.refreshSeconds * 1000);
    } else {
      stopNodesHealthPolling(clusterId);
    }
    return () => {
      stopNodesHealthPolling(clusterId);
    };
  });

  $effect(() => {
    if (!clusterId || watcherSettingsLoadedCluster !== clusterId) return;
    saveWatcherSettings(clusterId);
  });

  $effect(() => {
    watcherError = watcherEnabled ? $clusterHealth.error : null;
  });

  let allNodeData: NodesStatusesData[] = $state([]);
  let now = $state(Date.now());
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const selectedNode = writable<NodeItem | null>(null);
  const isSheetOpen = writable(false);
  const selectedNodeFocus = writable<{ section: "top" | "events" | null; token: number }>({
    section: null,
    token: 0,
  });

  let selectedNodeIds = $state(new Set<string>());
  let cordoningNodeIds = $state(new Set<string>());
  let drainingNodeIds = $state(new Set<string>());
  let deletingNodeIds = $state(new Set<string>());
  import { notifySuccess, notifyError, type ActionNotification } from "$shared/lib/action-notification";
  let actionNotification = $state<ActionNotification>(null);
  
  let runtimeSectionRefreshing = $state(false);
  let unschedulableOverrides = $state(new Map<string, boolean>());
  let taintsOverrides = $state(new Map<string, number>());
  let metricsEndpointsStatus = $state<Record<string, { status?: string }> | null>(null);
  let metricsSourceChecks = $state<MetricsSourceCheck[] | null>(null);
  const coreSourcesUnavailable = $derived(
    hasCoreMetricsSourcesUnavailableByChecks(
      (metricsSourceChecks ?? []) as Array<{
        id: string;
        status: "available" | "unreachable" | "not_found";
      }>,
    ) || hasCoreMetricsSourcesUnavailable(metricsEndpointsStatus ?? undefined),
  );

  const metricsUnavailable = $derived(
    $clusterNodes.length > 0 &&
      !$clusterHealth.isLoading &&
      !$clusterHealth.error &&
      $clusterHealth.data.length === 0,
  );

  const cpuMemUnavailable = $derived(
    allNodeData.length > 0 &&
      !$clusterHealth.isLoading &&
      !$clusterHealth.error &&
      allNodeData.every((node) => node.cpu === "N/A" && node.freeMemory === "N/A"),
  );
  const shouldShowMetricsUnavailableBanner = $derived(
    metricsUnavailable || cpuMemUnavailable,
  );
  const metricsUnavailableBannerMessage = $derived(
    coreSourcesUnavailable ? METRICS_BANNER_SUMMARY : METRICS_BANNER_PIPELINE,
  );
  const metricsUnavailableRecommendation = $derived.by(() => {
    if (!shouldShowMetricsUnavailableBanner) return null;
    return buildMetricsRecommendationText(metricsSourceChecks ?? undefined, "nodes");
  });
  const nodesRuntimeProfileLabel = $derived(
    `${getDashboardDataProfileDisplayName($dashboardDataProfile)} profile`,
  );
  const nodesRuntimeSourceState = $derived.by(() => {
    if (!watcherEnabled) return "paused";
    if (watcherError && allNodeData.length > 0) return "cached";
    if (watcherError) return "error";
    if ($clusterHealth.isLoading && allNodeData.length > 0) return "cached";
    if ($clusterHealth.isLoading) return "idle";
    if ($clusterHealth.lastUpdatedAt) return "live";
    if (allNodeData.length > 0) return "cached";
    return "idle";
  });
  const nodesRuntimeLastUpdatedLabel = $derived.by(() => {
    if (!$clusterHealth.lastUpdatedAt) return null;
    return `updated ${getTimeDifference(new Date($clusterHealth.lastUpdatedAt))} ago`;
  });
  const nodesRuntimeDetail = $derived.by(() => {
    if (!watcherEnabled) return "Node diagnostics are paused until you refresh or re-enable the watcher.";
    if (watcherError && allNodeData.length > 0) {
      return "Showing the last successful node snapshot while diagnostics are degraded.";
    }
    if (watcherError) return "Node diagnostics are degraded and need operator attention.";
    if ($clusterHealth.isLoading) return "Background node diagnostics are currently in flight.";
    return "Node diagnostics are operating within the current runtime budget.";
  });
  const nodesRuntimeReason = $derived.by(() => {
    if (watcherError) return watcherError;
    if (shouldShowMetricsUnavailableBanner) {
      return "Metrics source detail is degraded. Inspect the metrics banner for cluster-side guidance.";
    }
    return nodesResourceSyncPolicy.mode === "stream"
      ? `Streaming watcher active. Diagnostics refresh every ${watcherRefreshSeconds}s.`
      : `Polling node diagnostics every ${watcherRefreshSeconds}s.`;
  });

  async function loadMetricsEndpointsStatus() {
    if (!nodesAutoDiagnosticsEnabled) {
      metricsEndpointsStatus = null;
      metricsSourceChecks = null;
      return;
    }
    if (!data?.slug) return;
    try {
      const metricsSources = await runMetricsSourcesCheck(data.slug, { force: false });
      metricsSourceChecks = metricsSources?.checks ?? null;
      const checks = await getLastHealthCheck(data.slug);
      metricsEndpointsStatus =
        checks && !("errors" in checks) && checks.metricsChecks?.endpoints
          ? (checks.metricsChecks.endpoints as Record<string, { status?: string }>)
          : null;
    } catch {
      metricsEndpointsStatus = null;
      metricsSourceChecks = null;
    }
  }

  onMount(() => {
    intervalId = setInterval(() => {
      now = Date.now();
    }, 1000);
  });

  $effect(() => {
    if (!data?.slug) return;
    if (!nodesAutoDiagnosticsEnabled) {
      metricsEndpointsStatus = null;
      metricsSourceChecks = null;
      return;
    }
    void loadMetricsEndpointsStatus();
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });

  function getRoles(node: NodeItem) {
    return Object.keys(node.metadata.labels || {})
      .filter((k) => k.startsWith("node-role.kubernetes.io/"))
      .map((k) => k.slice("node-role.kubernetes.io/".length))
      .join(", ");
  }

  function getNodeConditions(node: NodeItem, unschedulable: boolean) {
    const conditions = node.status?.conditions ?? [];
    const active = conditions
      .filter((condition) => condition.status === "True")
      .map((condition) => condition.type)
      .filter((type): type is string => Boolean(type));

    const ready = conditions.find((condition) => condition.type === "Ready")?.status === "True";
    const normalized = new Set(active);

    if (ready) normalized.add("Ready");
    else normalized.add("NotReady");
    if (unschedulable) normalized.add("SchedulingDisabled");

    return [...normalized].join(",");
  }

  type CachedMetrics = { cpu: string; mem: string; disk: string };
  const lastKnownByName = new Map<string, CachedMetrics>();
  let hasEverUpdated = $state(false);

  $effect(() => {
    const nodes = $clusterNodes;
    const healthState = $clusterHealth;

    if (!nodes?.length) {
      allNodeData = [];
      return;
    }

    upsertNodesAge(nodes);

    const hasLiveSnapshot =
      !healthState.isLoading && !healthState.error && healthState.data.length > 0;

    if (!hasEverUpdated && hasLiveSnapshot) {
      hasEverUpdated = true;
    }

    if (hasLiveSnapshot) {
      for (const h of healthState.data) {
        lastKnownByName.set(h.name, {
          cpu: h.cpuUsage,
          mem: h.memoryUsage,
          disk: h.diskUsage,
        });
      }
    }

    const liveByName = new Map(healthState.data.map((n) => [n.name, n]));
    const cellsLoading = healthState.isLoading && !hasEverUpdated;

    allNodeData = nodes.map((nodePartial) => {
      const node = nodePartial as NodeItem;
      const uid = node.metadata?.uid ?? node.metadata?.name ?? "unknownNode";
      const createdAt =
        getNodeCreatedAt(uid) ?? new Date(node.metadata?.creationTimestamp ?? Date.now());
      const name = node.metadata?.name ?? "unknownNode";
      const live = liveByName.get(name);
      const cached = lastKnownByName.get(name);

      const cpu = live?.cpuUsage ?? (hasEverUpdated ? (cached?.cpu ?? null) : null);
      const freeMemory = live?.memoryUsage ?? (hasEverUpdated ? (cached?.mem ?? null) : null);
      const freeDisk = live?.diskUsage ?? (hasEverUpdated ? (cached?.disk ?? null) : null);
      const unschedulable = unschedulableOverrides.get(uid) ?? Boolean(node.spec?.unschedulable);
      const taints = taintsOverrides.get(uid) ?? (node.spec?.taints?.length ?? 0);
      const conditions = getNodeConditions(node, unschedulable);
      const problem = buildNodeProblemSignals({
        conditions,
        cpu,
        memory: freeMemory,
        taints,
      });

      return {
        uid,
        age: createdAt,
        cpu,
        freeMemory,
        freeDisk,
        conditions,
        name,
        roles: getRoles(node),
        taints,
        unschedulable,
        version: node.status?.nodeInfo?.kubeletVersion ?? "-",
        metricsLoading: cellsLoading,
        metricsError: healthState.error,
        metricsUpdatedAt: healthState.lastUpdatedAt,
        cpuSeverity: problem.cpuSeverity,
        memorySeverity: problem.memorySeverity,
        problemScore: problem.score,
      };
    });
  });

  function findNodeByRow(row: NodesStatusesData) {
    return (
      ($clusterNodes.find((item) => item.metadata?.name === row.name) as NodeItem | undefined) ??
      undefined
    );
  }

  function openSheet(node: NodeItem, section: "top" | "events" | null = null) {
    selectedNode.set(node);
    selectedNodeFocus.update((current) => ({ section, token: current.token + 1 }));
    isSheetOpen.set(true);
  }

  function setSetBusy(current: Set<string>, uid: string, busy: boolean) {
    const next = new Set(current);
    if (busy) next.add(uid);
    else next.delete(uid);
    return next;
  }

  function isNodeSelected(id: string) {
    return selectedNodeIds.has(id);
  }

  function toggleNodeSelection(id: string) {
    const next = new Set(selectedNodeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedNodeIds = next;
  }

  const availableNodeIds = $derived(allNodeData.map((node) => node.uid).filter(Boolean));
  const allSelected = $derived(
    availableNodeIds.length > 0 && availableNodeIds.every((id) => selectedNodeIds.has(id)),
  );
  const hasSomeSelected = $derived(
    !allSelected && availableNodeIds.some((id) => selectedNodeIds.has(id)),
  );
  const selectedNodes = $derived(allNodeData.filter((node) => selectedNodeIds.has(node.uid)));

  function toggleAllSelection() {
    if (availableNodeIds.length === 0) {
      selectedNodeIds = new Set<string>();
      return;
    }
    const shouldSelectAll = availableNodeIds.some((id) => !selectedNodeIds.has(id));
    selectedNodeIds = shouldSelectAll ? new Set(availableNodeIds) : new Set<string>();
  }

  $effect(() => {
    const available = new Set(availableNodeIds);
    const pruned = new Set([...selectedNodeIds].filter((id) => available.has(id)));
    if (pruned.size !== selectedNodeIds.size) selectedNodeIds = pruned;
  });

  $effect(() => {
    const available = new Set(availableNodeIds);
    const nextUnschedulable = new Map(
      [...unschedulableOverrides].filter(([id]) => available.has(id)),
    );
    if (nextUnschedulable.size !== unschedulableOverrides.size) {
      unschedulableOverrides = nextUnschedulable;
    }

    const nextTaints = new Map([...taintsOverrides].filter(([id]) => available.has(id)));
    if (nextTaints.size !== taintsOverrides.size) {
      taintsOverrides = nextTaints;
    }
  });

  function describeKubectlError(response: { errors: string; code?: number }, fallback: string) {
    if (response.errors?.trim()) return response.errors;
    if (response.code !== 0) return fallback;
    return "";
  }

  async function refreshNodeSchedulingState(nodeName: string, uid: string) {
    if (!data?.slug) return;
    const response = await kubectlRawArgsFront(["get", "node", nodeName, "-o", "json"], {
      clusterId: data.slug,
    });
    const errorMessage = describeKubectlError(
      response,
      `Failed to refresh node state for ${nodeName}.`,
    );
    if (errorMessage) throw new Error(errorMessage);

    const parsed = JSON.parse(response.output || "{}") as Partial<NodeItem>;
    const nextUnschedulable = Boolean(parsed.spec?.unschedulable);
    const nextTaints = parsed.spec?.taints?.length ?? 0;

    unschedulableOverrides = new Map(unschedulableOverrides).set(uid, nextUnschedulable);
    taintsOverrides = new Map(taintsOverrides).set(uid, nextTaints);
  }

  async function refreshNodesRuntimeSection() {
    if (!clusterId || runtimeSectionRefreshing) return;
    runtimeSectionRefreshing = true;
    watcherError = null;
    try {
      await Promise.all([
        refreshNodesHealthNow(clusterId),
        loadMetricsEndpointsStatus(),
      ]);
    } finally {
      runtimeSectionRefreshing = false;
    }
  }

  function toggleWatcher() {
    watcherEnabled = !watcherEnabled;
    watcherError = null;
  }

  function setWatcherRefreshSeconds(value: number) {
    watcherRefreshSeconds = Math.max(5, Math.min(600, Math.round(value)));
    watcherError = null;
  }

  function resetWatcherSettings() {
    watcherEnabled = DEFAULT_WATCHER_SETTINGS.enabled;
    watcherRefreshSeconds = DEFAULT_WATCHER_SETTINGS.refreshSeconds;
    watcherError = null;
  }

  // Workbench (Pods-like) for Node YAML tabs
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
  let yamlTabs = $state<YamlTabState[]>([]);
  let yamlCompareSourceTabId = $state<string | null>(null);
  let yamlComparePair = $state<[string, string] | null>(null);
  let yamlCompareTargetTabId = $state<string | null>(null);

  const orderedWorkbenchTabs = $derived.by(() => orderPinnedTabs(workbenchTabs, pinnedTabIds));
  const hasWorkbenchTabs = $derived(orderedWorkbenchTabs.length > 0);
  const activeWorkbenchTab = $derived(
    orderedWorkbenchTabs.find((tab) => tab.id === activeWorkbenchTabId) ?? null,
  );

  function getYamlTab(tabId: string) {
    return yamlTabs.find((tab) => tab.id === tabId) ?? null;
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

  const paneIndexes = $derived(getPaneIndexes());

  function getWorkbenchTab(tabId: string | null) {
    if (!tabId) return null;
    return orderedWorkbenchTabs.find((tab) => tab.id === tabId) ?? null;
  }

  function setPaneTabIdsIfChanged(next: [string | null, string | null, string | null]) {
    if (next[0] === paneTabIds[0] && next[1] === paneTabIds[1] && next[2] === paneTabIds[2]) return;
    paneTabIds = next;
  }

  function setCollapsedPaneIndexesIfChanged(next: number[]) {
    if (
      next.length === collapsedPaneIndexes.length &&
      next.every((value, idx) => value === collapsedPaneIndexes[idx])
    ) {
      return;
    }
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

    const { occupiedRemovedPaneCount, tabsToClose } = computeLayoutClosePlan(
      paneTabIds,
      nextPaneCount,
    );

    if (occupiedRemovedPaneCount === 0) {
      setWorkbenchLayout(nextLayout);
      return;
    }

    const confirmed = await confirmWorkbenchLayoutShrink();
    if (!confirmed) return;

    for (const tabId of tabsToClose) {
      await closeWorkbenchTab(tabId, { skipConfirm: true });
    }

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

    const yamlTab = getYamlTab(tabId);
    const target = yamlTab?.target ?? null;

    const nextEntry: ClosedWorkbenchTab = {
      kind: "yaml",
      target: target ? { ...target } : null,
      pinned: pinnedTabIds.has(tabId),
    };
    closedWorkbenchTabs = [
      nextEntry,
      ...closedWorkbenchTabs.filter((entry) => !(entry.target?.name === target?.name)),
    ].slice(0, 30);
  }

  async function closeWorkbenchTab(tabId: string, options: { skipConfirm?: boolean } = {}) {
    const previousTabs = workbenchTabs;
    const index = previousTabs.findIndex((item) => item.id === tabId);
    if (index === -1) return;

    const closingTab = previousTabs[index];
    if (!options.skipConfirm) {
      const confirmed = await confirmWorkbenchTabClose(closingTab);
      if (!confirmed) return;
    }

    rememberClosedTab(tabId);

    workbenchTabs = previousTabs.filter((tab) => tab.id !== tabId);
    pinnedTabIds = new Set([...pinnedTabIds].filter((id) => id !== tabId));
    yamlTabs = yamlTabs.filter((tab) => tab.id !== tabId);

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
    const row = allNodeData.find((item) => item.name === entry.target?.name);
    if (!row) return;

    await openNodeYamlEditor(row);
    if (entry.pinned) {
      pinnedTabIds = new Set([...pinnedTabIds, `yaml:cluster/${entry.target.name}`]);
    }
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
      if ((leftLines[idx] ?? "") !== (rightLines[idx] ?? "")) diffLines.push(idx + 1);
    }

    return diffLines;
  }

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
        if (nextPaneTabIds[idx] && !ids.includes(nextPaneTabIds[idx] as string)) {
          nextPaneTabIds[idx] = null;
        }
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

  async function refreshYamlForTab(tabId: string) {
    if (!data?.slug) return;
    const tab = getYamlTab(tabId);
    if (!tab) return;

    updateYamlTab(tabId, (current) => ({ ...current, yamlLoading: true, yamlError: null }));

    try {
      const response = await kubectlRawArgsFront(["get", "node", tab.target.name, "-o", "yaml"], {
        clusterId: data.slug,
      });
      if (response.errors || response.code !== 0) {
        throw new Error(response.errors || `Failed to load node YAML for ${tab.target.name}.`);
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
        yamlError: error instanceof Error ? error.message : "Failed to load node YAML.",
      }));
    }
  }

  async function saveYamlChanges(tabId: string) {
    const tab = getYamlTab(tabId);
    if (!tab || !data?.slug) return;

    if (!tab.yamlText.trim()) {
      updateYamlTab(tabId, (current) => ({ ...current, yamlError: "YAML is empty." }));
      return;
    }

    updateYamlTab(tabId, (current) => ({ ...current, yamlSaving: true, yamlError: null }));

    const relativePath = `tmp/node-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`;

    try {
      await mkdir("tmp", { recursive: true, baseDir: BaseDirectory.AppData });
      await writeTextFile(relativePath, tab.yamlText, { baseDir: BaseDirectory.AppData });

      const appDataPath = await path.appDataDir();
      const absolutePath = await path.join(appDataPath, relativePath);
      const response = await kubectlRawArgsFront(["apply", "-f", absolutePath], {
        clusterId: data.slug,
      });

      const errorMessage = describeKubectlError(
        response,
        `Failed to apply YAML for node ${tab.target.name}.`,
      );
      if (errorMessage) throw new Error(errorMessage);

      actionNotification = null;
      actionNotification = notifySuccess(`Applied YAML: ${tab.target.name}`);

      await refreshYamlForTab(tabId);
    } catch (error) {
      updateYamlTab(tabId, (current) => ({
        ...current,
        yamlSaving: false,
        yamlError: error instanceof Error ? error.message : "Failed to apply node YAML.",
      }));
      return;
    } finally {
      updateYamlTab(tabId, (current) => ({ ...current, yamlSaving: false }));
      try {
        await remove(relativePath, { baseDir: BaseDirectory.AppData });
      } catch {
        // ignore temp cleanup errors
      }
    }
  }

  async function copyDescribeForNode(row: NodesStatusesData) {
    const name = row.name;
    if (!name || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
    const cmd = buildKubectlDescribeCommand({ resource: "node", name });
    await navigator.clipboard.writeText(cmd);
    actionNotification = notifySuccess(`Copied: ${cmd}`);
  }

  function openDebugDescribeForNode(row: NodesStatusesData) {
    const clusterId = data?.slug;
    if (!clusterId || !row.name) return;
    runDebugDescribe({ clusterId, resource: "node", name: row.name });
  }

  async function downloadYamlForNode(row: NodesStatusesData) {
    const clusterId = data?.slug;
    if (!clusterId || !row.name) return;
    try {
      const result = await kubectlRawArgsFront(
        ["get", "node", row.name, "-o", "yaml"],
        { clusterId },
      );
      if (result.errors || result.code !== 0) {
        actionNotification = notifyError(result.errors || "Failed to fetch node YAML.");
        return;
      }
      const filename = `node-${row.name}.yaml`;
      const dir = `downloads`;
      await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
      const filePath = await path.join(dir, filename);
      await writeTextFile(filePath, result.output, { baseDir: BaseDirectory.AppData });
      actionNotification = notifySuccess(`Downloaded YAML to ${filePath}`);
    } catch (err) {
      actionNotification = notifyError(err instanceof Error ? err.message : "Failed to download YAML.");
    }
  }


  async function openNodeYamlEditor(row: NodesStatusesData) {
    const node = findNodeByRow(row);
    if (!node?.metadata?.name) return;

    const name = node.metadata.name;
    const tabId = `yaml:cluster/${name}`;

    const existing = getYamlTab(tabId);
    if (!existing) {
      yamlTabs = [
        ...yamlTabs,
        {
          id: tabId,
          target: { name },
          yamlLoading: true,
          yamlSaving: false,
          yamlError: null,
          yamlText: "",
          yamlOriginalText: "",
        },
      ];
    } else {
      updateYamlTab(tabId, (current) => ({ ...current, target: { name }, yamlLoading: true, yamlError: null }));
    }

    upsertWorkbenchTab({ id: tabId, kind: "yaml", title: `YAML ${name}`, subtitle: "cluster" });
    workbenchCollapsed = false;
    workbenchFullscreen = false;

    await refreshYamlForTab(tabId);
  }

  async function handleToggleCordon(row: NodesStatusesData) {
    const node = findNodeByRow(row);
    if (!node?.metadata?.name) return;

    const nextAction = row.unschedulable ? "uncordon" : "cordon";
    const confirmed = await confirmAction(
      nextAction === "cordon"
        ? `Cordon node ${node.metadata.name}? New pods will not be scheduled there.`
        : `Uncordon node ${node.metadata.name}? Pod scheduling will be re-enabled.`,
      nextAction === "cordon" ? "Cordon node" : "Uncordon node",
    );
    if (!confirmed) return;

    cordoningNodeIds = setSetBusy(cordoningNodeIds, row.uid, true);
    actionNotification = null;

    try {
      const response = await kubectlRawArgsFront([nextAction, node.metadata.name], {
        clusterId: data.slug,
      });
      const errorMessage = describeKubectlError(
        response,
        `Failed to ${nextAction} node ${node.metadata.name}.`,
      );
      if (errorMessage) throw new Error(errorMessage);

      unschedulableOverrides = new Map(unschedulableOverrides).set(
        row.uid,
        nextAction === "cordon",
      );
      await refreshNodeSchedulingState(node.metadata.name, row.uid);
      actionNotification = notifySuccess(`Node ${node.metadata.name} ${nextAction === "cordon" ? "cordoned" : "uncordoned"}.`);
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : `Failed to ${nextAction} node.`);
    } finally {
      cordoningNodeIds = setSetBusy(cordoningNodeIds, row.uid, false);
    }
  }

  async function handleToggleCordonNodes(rows: NodesStatusesData[]) {
    for (const row of rows) {
      await handleToggleCordon(row);
    }
  }

  async function handleDrain(row: NodesStatusesData) {
    const node = findNodeByRow(row);
    if (!node?.metadata?.name) return;

    const confirmed = await confirmAction(
      `Drain node ${node.metadata.name}? This will evict workloads from the node.`,
      "Drain node",
    );
    if (!confirmed) return;

    drainingNodeIds = setSetBusy(drainingNodeIds, row.uid, true);
    actionNotification = null;

    try {
      const response = await kubectlRawArgsFront(
        [
          "drain",
          node.metadata.name,
          "--ignore-daemonsets",
          "--delete-emptydir-data",
          "--force",
          "--grace-period=30",
          "--timeout=120s",
        ],
        { clusterId: data.slug },
      );
      const errorMessage = describeKubectlError(
        response,
        `Failed to drain node ${node.metadata.name}.`,
      );
      if (errorMessage) throw new Error(errorMessage);

      await refreshNodeSchedulingState(node.metadata.name, row.uid);
      actionNotification = notifySuccess(`Node ${node.metadata.name} drained.`);
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to drain node.");
    } finally {
      drainingNodeIds = setSetBusy(drainingNodeIds, row.uid, false);
    }
  }

  async function handleDrainNodes(rows: NodesStatusesData[]) {
    for (const row of rows) {
      await handleDrain(row);
    }
  }

  async function handleDelete(row: NodesStatusesData) {
    const node = findNodeByRow(row);
    if (!node?.metadata?.name) return;

    const confirmed = await confirmAction(
      `Delete node ${node.metadata.name}? This cannot be undone.`,
      "Delete node",
    );
    if (!confirmed) return;

    deletingNodeIds = setSetBusy(deletingNodeIds, row.uid, true);
    actionNotification = null;

    try {
      const response = await kubectlRawArgsFront(["delete", "node", node.metadata.name], {
        clusterId: data.slug,
      });
      const errorMessage = describeKubectlError(
        response,
        `Failed to delete node ${node.metadata.name}.`,
      );
      if (errorMessage) throw new Error(errorMessage);

      actionNotification = notifySuccess(`Node ${node.metadata.name} deleted.`);
    } catch (error) {
      actionNotification = notifyError(error instanceof Error ? error.message : "Failed to delete node.");
    } finally {
      deletingNodeIds = setSetBusy(deletingNodeIds, row.uid, false);
    }
  }

  async function handleDeleteNodes(rows: NodesStatusesData[]) {
    for (const row of rows) {
      await handleDelete(row);
    }
    selectedNodeIds = new Set<string>();
  }

  const columns = $derived(
    createColumns({
      isSelected: isNodeSelected,
      onToggleSelect: toggleNodeSelection,
      areAllSelected: allSelected,
      isSomeSelected: hasSomeSelected,
      onToggleAll: toggleAllSelection,
      onShowDetails: (row) => {
        const node = findNodeByRow(row);
        if (node) openSheet(node);
      },
      onTopNode: (row) => {
        const node = findNodeByRow(row);
        if (node) openSheet(node, "top");
      },
      onEvents: (row) => {
        const node = findNodeByRow(row);
        if (node) openSheet(node, "events");
      },
      onShell: (row) => {
        actionNotification = null;
        actionNotification = notifySuccess(`Shell for node ${row.name} will be connected via SSH soon.`);
      },
      onToggleCordon: (row) => {
        void handleToggleCordon(row);
      },
      onDrain: (row) => {
        void handleDrain(row);
      },
      onEditYaml: (row) => {
        void openNodeYamlEditor(row);
      },
      onCopyDescribe: (row) => {
        void copyDescribeForNode(row);
      },
      onRunDebugDescribe: (row) => {
        openDebugDescribeForNode(row);
      },
      onDownloadYaml: (row) => {
        void downloadYamlForNode(row);
      },
      onDelete: (row) => {
        void handleDelete(row);
      },
      isCordoning: (uid) => cordoningNodeIds.has(uid),
      isDraining: (uid) => drainingNodeIds.has(uid),
      isDeleting: (uid) => deletingNodeIds.has(uid),
    }),
  );
</script>

{#if allNodeData.length}
  <ActionNotificationBar notification={actionNotification} onDismiss={() => { actionNotification = null; }} />

  <div class="text-sm font-medium mb-2">Nodes</div>

  {#if hasWorkbenchTabs}
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
    >
      {#snippet tabActions(tab)}
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
          title={!yamlCompareSourceTabId
            ? "Set as compare source"
            : yamlCompareSourceTabId === tab.id
              ? "Clear compare source"
              : isYamlCompareTarget(tab.id)
                ? "Disable compare"
                : "Compare with selected"}
          aria-label="Compare with selected"
        >
          <GitCompareArrows class="h-4 w-4" />
        </button>
      {/snippet}
      {#snippet body()}
        {#if !workbenchCollapsed && activeWorkbenchTab}
          <div class={workbenchFullscreen ? "min-h-0 flex-1" : "h-[min(70dvh,760px)] min-h-[430px]"}>
            {#if workbenchLayout === "single"}
              {@const currentYamlTab = getYamlTab(activeWorkbenchTab.id)}
              <ResourceYamlSheet
                embedded={true}
                isOpen={workbenchOpen}
                podRef={currentYamlTab ? currentYamlTab.target.name : "-"}
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
                  void saveYamlChanges(currentYamlTab.id);
                }}
              />
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
                    {#if paneTab && paneTab.kind === "yaml"}
                      {@const tab = getYamlTab(paneTab.id)}
                      <ResourceYamlSheet
                        embedded={true}
                        isOpen={workbenchOpen}
                        podRef={tab ? tab.target.name : "-"}
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
                          void saveYamlChanges(tab.id);
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
  {/if}

  {#if selectedNodeIds.size > 0}
    <WorkloadSelectionBar count={selectedNodeIds.size}>
      {#snippet children()}
        <NodeBulkActions
          mode={selectedNodeIds.size === 1 ? "single" : "multi"}
          canOpenShell={selectedNodeIds.size === 1}
          canEditYaml={selectedNodeIds.size === 1}
          isCordoning={selectedNodes.some((node) => cordoningNodeIds.has(node.uid))}
          isDraining={selectedNodes.some((node) => drainingNodeIds.has(node.uid))}
          isDeleting={selectedNodes.some((node) => deletingNodeIds.has(node.uid))}
          isUnschedulableSelection={selectedNodes.length > 0 && selectedNodes.every((node) => node.unschedulable)}
          onTopNode={() => {
            const selected = selectedNodes[0];
            const node = selected ? findNodeByRow(selected) : null;
            if (node) openSheet(node, "top");
          }}
          onEvents={() => {
            const selected = selectedNodes[0];
            const node = selected ? findNodeByRow(selected) : null;
            if (node) openSheet(node, "events");
          }}
          onShell={() => {
            const selected = selectedNodes[0];
            if (!selected) return;
            actionNotification = null;
            actionNotification = notifySuccess(`Shell for node ${selected.name} will be connected via SSH soon.`);
          }}
          onToggleCordon={() => {
            void handleToggleCordonNodes(selectedNodes);
          }}
          onDrain={() => {
            void handleDrainNodes(selectedNodes);
          }}
          onEditYaml={() => {
            const selected = selectedNodes[0];
            if (!selected) return;
            void openNodeYamlEditor(selected);
          }}
          onCopyDescribe={() => {
            const selected = selectedNodes[0];
            if (selected) void copyDescribeForNode(selected);
          }}
          onRunDebugDescribe={() => {
            const selected = selectedNodes[0];
            if (selected) openDebugDescribeForNode(selected);
          }}
          onDownloadYaml={() => {
            const selected = selectedNodes[0];
            if (selected) void downloadYamlForNode(selected);
          }}
          onDelete={() => {
            void handleDeleteNodes(selectedNodes);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            selectedNodeIds = new Set<string>();
          }}
        >
          Clear
        </Button>
      {/snippet}
    </WorkloadSelectionBar>
  {/if}

  {#if shouldShowMetricsUnavailableBanner}
    <div class="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {metricsUnavailableBannerMessage}
      {#if metricsUnavailableRecommendation}
        {metricsUnavailableRecommendation}
      {/if}
      {METRICS_BANNER_DISK_NOTE}
      <a
        href={buildMetricsSourcesHref(data.slug)}
        class="ml-1 font-medium underline underline-offset-2 hover:text-amber-900"
      >
        {METRICS_BANNER_CTA}
      </a>
      .
    </div>
  {/if}

  <ResourceSummaryStrip
    items={[
      { label: "Cluster", value: resolvePageClusterName(data), tone: "foreground" },
      { label: "Nodes", value: allNodeData.length },
      { label: "Sync", value: nodesRuntimeSourceState },
    ]}
  />

  <div class="mb-4">
    <SectionRuntimeStatus
      sectionLabel="Nodes Runtime Status"
      profileLabel={nodesRuntimeProfileLabel}
      sourceState={nodesRuntimeSourceState}
      mode={watcherEnabled ? (nodesResourceSyncPolicy.mode === "stream" ? "stream" : "poll") : "manual"}
      budgetSummary={`sync ${watcherRefreshSeconds}s`}
      lastUpdatedLabel={nodesRuntimeLastUpdatedLabel}
      detail={nodesRuntimeDetail}
      secondaryActionLabel="Update"
      secondaryActionAriaLabel="Refresh nodes runtime section"
      secondaryActionLoading={runtimeSectionRefreshing || $clusterHealth.isLoading}
      onSecondaryAction={() => void refreshNodesRuntimeSection()}
      reason={nodesRuntimeReason}
      actionLabel={watcherEnabled ? "Pause section" : "Resume section"}
      actionAriaLabel={watcherEnabled ? "Pause nodes runtime section" : "Resume nodes runtime section"}
      onAction={toggleWatcher}
    />
  </div>

  <DataTable
    data={allNodeData}
    {columns}
    {watcherEnabled}
    {watcherRefreshSeconds}
    {watcherError}
    onToggleWatcher={toggleWatcher}
    onWatcherRefreshSecondsChange={setWatcherRefreshSeconds}
    onResetWatcherSettings={resetWatcherSettings}
    onCsvDownloaded={({ pathHint, rows }) => {
      actionNotification = null;
      actionNotification = notifySuccess(`CSV exported: ${pathHint} (${rows} rows).`);
    }}
    onRowClick={(row) => {
      const node = findNodeByRow(row);
      if (node) openSheet(node);
    }}
  />

  <DataSheet
    clusterId={data.slug}
    data={selectedNode}
    isOpen={isSheetOpen}
    focus={selectedNodeFocus}
    onShell={() => {
      const node = $selectedNode;
      if (!node?.metadata?.name) return;
      actionNotification = null;
      actionNotification = notifySuccess(`Shell for node ${node.metadata.name} will be connected via SSH soon.`);
    }}
    onEditYaml={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (!row) return;
      void openNodeYamlEditor(row);
    }}
    onCopyDescribe={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (row) void copyDescribeForNode(row);
    }}
    onRunDebugDescribe={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (row) openDebugDescribeForNode(row);
    }}
    onDownloadYaml={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (row) void downloadYamlForNode(row);
    }}
    onToggleCordon={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (!row) return;
      void handleToggleCordon(row);
    }}
    onDrain={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (!row) return;
      void handleDrain(row);
    }}
    onDelete={() => {
      const node = $selectedNode;
      const row = node?.metadata?.name
        ? allNodeData.find((item) => item.name === node.metadata?.name) ?? null
        : null;
      if (!row) return;
      void handleDelete(row);
    }}
  />
{:else}
  No data provided
{/if}
