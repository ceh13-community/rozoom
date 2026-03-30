<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { derived, type Readable } from "svelte/store";
  import * as Sentry from "@sentry/sveltekit";
  import Pin from "@lucide/svelte/icons/pin";
  import PinOff from "@lucide/svelte/icons/pin-off";
  import X from "@lucide/svelte/icons/x";
  import { NamespaceSelect } from "$widgets/namespace";
  import { WorkloadDisplay } from "$widgets/workload";
  import * as Alert from "$shared/ui/alert";
  import { Badge } from "$shared/ui/badge";
  import { Skeleton } from "$shared/ui/skeleton";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { getTimeDifference, timeAgo } from "$shared/lib/timeFormatters";
  import {
    clustersList,
    isClustersConfigLoading,
    loadClusters,
    findClusterByUuid,
  } from "$features/cluster-manager/";
  import { openShellModal, shellModalState } from "$features/shell";
  // import { useWorkloads } from "$features/workloads-management";
  import {
    EMPTY_NAMESPACE_SELECTION,
    getSelectedNamespaceList,
    getClusterNamespaces,
    namespaces,
    selectedNamespace,
    namespacesError,
    isNamespacesLoading,
    setSelectedNamespace,
    applyDefaultNamespace,
  } from "$features/namespace-management";
  import type { WorkloadType } from "$shared/model/workloads";
  import { type PageData } from "$entities/cluster";
  import {
    createWorkloadsStore,
    listWorkloadEvents,
    prefetchWorkloadSnapshots,
  } from "$features/workloads-management";
  import {
    setClusterRuntimeDegraded,
    clusterRuntimeOverrides,
    resolveClusterRuntimeBudgetForCluster,
    resolveClusterRuntimeState,
  } from "$shared/lib/cluster-runtime-manager";
  import {
    dashboardDataProfile,
    resolvePrefetchConcurrency,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import ClusterRuntimeTuningPanel from "$widgets/cluster/ui/cluster-runtime-tuning-panel.svelte";
  import ClusterRequestDebugInspector from "$widgets/cluster/ui/cluster-request-debug-inspector.svelte";
  import {
    CLUSTER_HEALTH_WORKLOADS,
    CLUSTER_SWITCH_PREFETCH_WORKLOADS,
    WORKSPACE_WORKLOAD_OPTIONS,
    getWorkloadOptionGroups,
    configurationWorkloads,
    hasRenderableWorkloadData,
    namespaceScopedWorkloads,
    toPinnedWorkloadType,
    toWorkloadLabel,
    WORKLOAD_LABEL_OVERRIDES,
  } from "../model/cluster-page-workload-config";
  import {
    cloneWorkspacePanes,
    createDefaultWorkspacePanes,
    createPaneTab as createWorkspacePaneTab,
    MAX_PINNED_CLUSTER_TABS,
    normalizeWorkspacePanes as normalizeStoredWorkspacePanes,
    type PinnedClusterTab,
    type PinnedWorkspaceSession,
    readPinnedTabs,
    pruneStalePins,
    readPinnedWorkspaceSessions,
    readWorkspaceLayout,
    readWorkspacePanes,
    savePinnedTabs,
    savePinnedWorkspaceSessions,
    saveWorkspaceLayout,
    saveWorkspacePanes,
    sameWorkspacePanes,
    toClusterWorkloadHref,
    type WorkspaceLayout,
    type WorkspacePaneId,
    type WorkspacePaneState,
    type WorkspacePaneTab,
    WORKSPACE_MAX_TABS_PER_PANE,
  } from "../model/cluster-page-workspace";
  import {
    createEmptyClusterSyncStatusStore,
    createEmptyNodesHealthStatusStore,
    deriveSyncStateText,
    readWorkloadSyncStatus,
    selectNodesHealthStatusStore,
    selectWorkloadSyncStatusStore,
    syncBadgeText as formatSyncBadgeText,
    syncBadgeTone as resolveSyncBadgeTone,
    type ClusterSyncStatus,
    type GenericSyncStatus,
    type NodesHealthSyncStatus,
  } from "../model/cluster-page-sync-status";
  import {
    appendDebugLog,
    appendRouteTrace,
    buildRouteTraceEntry,
    buildWorkspaceDebugSnapshot,
    buildWorkspaceRouteTracePayload,
    createDraggedPaneTabPayload,
    formatSyncUpdatedAt as formatRelativeSyncUpdatedAt,
    parseDraggedPaneTabPayload,
    workspaceLayoutBadge as resolveWorkspaceLayoutBadge,
    type DebugLogEntry,
    type DraggedPaneTabPayload,
    type WorkspaceRouteTraceEntry,
  } from "../model/cluster-page-debug";
  import {
    buildClosedPaneState,
    buildPanePageData as buildPanePageDataModel,
    buildPaneTabList,
    buildSecondaryPaneState,
    findPaneTab,
    paneHasEffectiveData as derivePaneHasEffectiveData,
    paneIndexLabel as resolvePaneIndexLabel,
    paneStatusClass as resolvePaneStatusClass,
    paneStatusLabel as derivePaneStatusLabel,
  } from "../model/cluster-page-panes";
  import {
    buildOverviewSyncDebugEvent,
    buildPrimaryPaneRouteState,
    buildRouteDebugKey,
    buildWorkspaceRouteKey,
    prunePinnedWorkspaceSessions,
    resolveWorkspaceNavigationSource,
    buildPinnedSessionRestore,
  } from "../model/cluster-page-effects";
  import {
    buildClusterTrustBannerModel,
    buildWorkloadPerfRows,
    buildClusterRequestInspector,
    buildAdaptiveConnectivityState,
    buildWorkloadTelemetrySummary,
    readWatcherTelemetryRows,
    readWatcherTelemetrySummary,
    resolveRelativeTickMs,
    stopClusterDetailBackgroundPollers,
  } from "../model/cluster-page-runtime";

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
  const PINNED_CLUSTER_TABS_KEY = "dashboard.cluster.pinned-tabs.v1";
  const DEBUG_LOGS_ENABLED_KEY = "dashboard.cluster.debug-logs-enabled.v1";
  const ENABLE_WORKSPACE_DEBUG_PANEL = import.meta.env.VITE_ENABLE_WORKSPACE_DEBUG_PANEL === "true";
  const WORKSPACE_LAYOUT_KEY = "dashboard.cluster.workspace-layout.v1";
  const WORKSPACE_PANES_KEY = "dashboard.cluster.workspace-panes.v1";
  const PINNED_WORKSPACE_SESSIONS_KEY = "dashboard.cluster.pinned-workspace-sessions.v1";
  const SINGLE_PAGE_HINT_SHOWN_KEY = "dashboard.cluster.single-page-hint-shown.v1";
  const WORKSPACE_ROUTE_TRACE_LIMIT = 100;
  const cluster = $derived(data.slug);
  const sortField = $derived(data.sort_field || "name");
  const routeWorkloadType = $derived((data.workload as WorkloadType) || "overview");
  const currentWorkload = $derived((data.workload as string) || "overview");
  let clusterName = $state<string | undefined>(undefined);
  const clusterSelectOptions = $derived.by(() => {
    const options = ($clustersList || [])
      .filter((entry) => !entry.offline)
      .map((entry) => ({
        value: entry.uuid,
        label: entry.displayName || entry.name || entry.uuid,
      }));
    if (!options.some((option) => option.value === cluster)) {
      options.unshift({
        value: cluster,
        label: clusterName || cluster,
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  });

  let pinnedTabs = $state<PinnedClusterTab[]>([]);
  let pinnedTabsHydrated = $state(false);
  let workspaceHydrated = $state(false);
  let workspaceLayout = $state<WorkspaceLayout>(1);
  let transientWorkspaceLayout = $state<WorkspaceLayout>(1);
  let preserveNextSinglePaneReset = $state(false);
  let nextNavigationSource = $state<"workspace" | null>(null);
  let lastNavigationSource = $state<"left_menu" | "workspace" | "unknown">("unknown");
  let previousRouteWasPinned = $state<boolean | null>(null);
  let copiedRouteTrace = $state(false);
  let workspaceRouteTrace = $state<WorkspaceRouteTraceEntry[]>([]);
  let pinnedWorkspaceSessions = $state<Record<string, PinnedWorkspaceSession>>({});
  let copiedDebugState = $state(false);
  let debugLogsEnabled = $state(false);
  let debugLogs = $state<DebugLogEntry[]>([]);
  let clusterSwitchInFlight = $state(false);
  let relativeTimeTick = $state(Date.now());
  let workspaceHydrationTimeout: ReturnType<typeof setTimeout> | null = null;
  let workspacePanes = $state<Record<WorkspacePaneId, WorkspacePaneState>>(
    createDefaultWorkspacePanes(),
  );

  const workloads = createWorkloadsStore({
    clusterUuid: "",
    namespace: "all",
  });
  const pane2Workloads = createWorkloadsStore({
    clusterUuid: "",
    namespace: "all",
    initialWorkloadType: "overview",
  });
  const pane3Workloads = createWorkloadsStore({
    clusterUuid: "",
    namespace: "all",
    initialWorkloadType: "overview",
  });

  const isLoading = $derived(workloads.isLoading);
  const errorMessage = $derived(namespacesError || workloads.error);
  const isClusterHealthView = $derived(CLUSTER_HEALTH_WORKLOADS.includes(routeWorkloadType));
  const isRouteManagedPodsView = $derived(routeWorkloadType === "pods");
  const workloadCacheBanner = $derived.by(() => {
    if (isRouteManagedPodsView) return null;
    const cache = workloads.cache;
    if (cache.state === "miss" || !cache.cachedAt) return null;
    const age = getTimeDifference(new Date(cache.cachedAt));
    const ageLabel = age === "0s" ? "just now" : `${age} ago`;
    const prefix = cache.state === "stale" ? "Stale cache" : "Cached";
    const suffix = isLoading ? "Refreshing" : "Ready";
    return `${prefix} · ${ageLabel} · ${suffix}`;
  });
  const workloadTelemetrySummary = $derived.by(() => {
    const tick = relativeTimeTick;
    void tick;
    return buildWorkloadTelemetrySummary(listWorkloadEvents());
  });
  const workloadPerfRows = $derived.by(() => {
    const tick = relativeTimeTick;
    void tick;
    return buildWorkloadPerfRows(listWorkloadEvents());
  });
  const watcherTelemetrySummary = $derived.by(() => {
    const tick = relativeTimeTick;
    void tick;
    return readWatcherTelemetrySummary();
  });
  const watcherTelemetryRows = $derived.by(() => {
    const tick = relativeTimeTick;
    void tick;
    return readWatcherTelemetryRows();
  });
  const clusterSwitchPrefetchMaxConcurrent = $derived(
    resolvePrefetchConcurrency($dashboardDataProfile, 4),
  );
  const clusterRuntimeState = $derived(resolveClusterRuntimeState(cluster));
  const clusterRuntimeBudget = $derived(resolveClusterRuntimeBudgetForCluster(cluster));
  const clusterRuntimeOverride = $derived($clusterRuntimeOverrides[cluster] ?? null);
  const clusterRuntimeBudgetSummary = $derived.by(() => {
    return `${clusterRuntimeBudget.maxConcurrentConnections} conn / ${clusterRuntimeBudget.maxConcurrentHeavyChecks} heavy`;
  });
  const clusterRuntimeProfileSummary = $derived.by(() => {
    return `${$dashboardDataProfile.label} profile`;
  });
  const clusterRequestInspector = $derived.by(() => {
    const tick = relativeTimeTick;
    void tick;
    return buildClusterRequestInspector(cluster);
  });
  const adaptiveConnectivityState = $derived.by(() => {
    const tick = relativeTimeTick;
    void tick;
    return buildAdaptiveConnectivityState(cluster);
  });
  const clusterTrustBanner = $derived.by(() => {
    return buildClusterTrustBannerModel({
      adaptiveConnectivityState,
      clusterRuntimeState,
      clusterRuntimeProfileSummary,
      workloadCacheBanner,
    });
  });

  let lastWorkloadData = $state<unknown>(null);
  let lastWorkloadDataKey = $state<string | null>(null);
  let namespacesClusterLoaded = $state<string | null>(null);
  const emptyPodsSyncStatus: Readable<ClusterSyncStatus> = createEmptyClusterSyncStatusStore();
  let podsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let deploymentsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let daemonSetsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let statefulSetsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let replicaSetsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let jobsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let cronJobsSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let configurationSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let overviewSyncStatus: Readable<ClusterSyncStatus> = $state(emptyPodsSyncStatus);
  let nodesHealthStatus: Readable<NodesHealthSyncStatus> = $state(
    createEmptyNodesHealthStatusStore(),
  );

  const isNamespaceScoped = $derived(namespaceScopedWorkloads.has(routeWorkloadType));
  const resolvedWorkloadNamespace = $derived.by(() => {
    const currentNamespace = $selectedNamespace || "all";
    const selectedNamespaces = getSelectedNamespaceList(currentNamespace);
    if (!isNamespaceScoped) return "all";
    if (!selectedNamespaces) return "all";
    if (selectedNamespaces.length === 0) return EMPTY_NAMESPACE_SELECTION;
    if (selectedNamespaces.length === 1) return selectedNamespaces[0];
    return selectedNamespaces.join(",");
  });
  const currentWorkloadDataKey = $derived(
    `${cluster}::${routeWorkloadType ?? "pods"}::${resolvedWorkloadNamespace}::${sortField ?? "name"}`,
  );

  $effect(() => {
    if (!cluster) return;
    setClusterRuntimeDegraded(cluster, adaptiveConnectivityState.active);
  });

  $effect(() => {
    if (!cluster) return;
    if (routeWorkloadType === "pods") {
      workloads.reset();
      return;
    }
    workloads.updateParams({
      clusterUuid: cluster,
      workloadType: routeWorkloadType,
      namespace: resolvedWorkloadNamespace,
      sortField,
    });
  });

  $effect(() => {
    if (!workspaceHydrated || effectiveWorkspaceLayout < 2) {
      pane2Workloads.reset();
      return;
    }
    const pane = workspacePanes["pane-2"];
    if (pane.workload === "pods") {
      pane2Workloads.reset();
      return;
    }
    pane2Workloads.updateParams({
      clusterUuid: pane.clusterId || cluster,
      workloadType: pane.workload,
      sortField: pane.sortField,
      namespace: "all",
    });
  });

  $effect(() => {
    if (!workspaceHydrated || effectiveWorkspaceLayout < 3) {
      pane3Workloads.reset();
      return;
    }
    const pane = workspacePanes["pane-3"];
    if (pane.workload === "pods") {
      pane3Workloads.reset();
      return;
    }
    pane3Workloads.updateParams({
      clusterUuid: pane.clusterId || cluster,
      workloadType: pane.workload,
      sortField: pane.sortField,
      namespace: "all",
    });
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "pods") {
      podsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    podsSyncStatus = selectWorkloadSyncStatusStore(cluster, "pods") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "deployments") {
      deploymentsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    deploymentsSyncStatus =
      selectWorkloadSyncStatusStore(cluster, "deployments") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "daemonsets") {
      daemonSetsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    daemonSetsSyncStatus =
      selectWorkloadSyncStatusStore(cluster, "daemonsets") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "statefulsets") {
      statefulSetsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    statefulSetsSyncStatus =
      selectWorkloadSyncStatusStore(cluster, "statefulsets") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "replicasets") {
      replicaSetsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    replicaSetsSyncStatus =
      selectWorkloadSyncStatusStore(cluster, "replicasets") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "jobs") {
      jobsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    jobsSyncStatus = selectWorkloadSyncStatusStore(cluster, "jobs") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "cronjobs") {
      cronJobsSyncStatus = emptyPodsSyncStatus;
      return;
    }
    cronJobsSyncStatus = selectWorkloadSyncStatusStore(cluster, "cronjobs") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || !configurationWorkloads.has(routeWorkloadType)) {
      configurationSyncStatus = emptyPodsSyncStatus;
      return;
    }
    configurationSyncStatus =
      selectWorkloadSyncStatusStore(cluster, routeWorkloadType) ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "overview") {
      overviewSyncStatus = emptyPodsSyncStatus;
      return;
    }
    overviewSyncStatus = selectWorkloadSyncStatusStore(cluster, "overview") ?? emptyPodsSyncStatus;
  });

  $effect(() => {
    if (!cluster || routeWorkloadType !== "nodesstatus") {
      nodesHealthStatus = createEmptyNodesHealthStatusStore();
      return;
    }
    nodesHealthStatus = selectNodesHealthStatusStore(cluster, routeWorkloadType);
  });

  $effect(() => {
    if (!cluster || $isNamespacesLoading) return;
    if (namespacesClusterLoaded === cluster) return;
    if (!isNamespaceScoped) return;
    namespacesClusterLoaded = cluster;
    void getClusterNamespaces(cluster);
  });

  $effect(() => {
    if (workloads.data === null || workloads.data === undefined) return;
    lastWorkloadData = workloads.data;
    lastWorkloadDataKey = currentWorkloadDataKey;
  });

  const effectiveWorkloadData = $derived(
    isLoading &&
      lastWorkloadData &&
      lastWorkloadDataKey !== null &&
      lastWorkloadDataKey === currentWorkloadDataKey
      ? lastWorkloadData
      : workloads.data,
  );
  const hasEffectiveWorkloadData = $derived(
    Boolean(
      (isClusterHealthView ||
        isRouteManagedPodsView ||
        hasRenderableWorkloadData(routeWorkloadType, effectiveWorkloadData)) &&
        data,
    ),
  );
  const hasActiveDebugShell = $derived.by(() => {
    return $shellModalState.some((windowState) => {
      return windowState.clusterId === cluster && windowState.targetPod === null;
    });
  });
  const currentTabHref = $derived.by(() => {
    const workload = currentWorkload || "overview";
    const params = new URLSearchParams();
    params.set("workload", workload);
    if (sortField) params.set("sort_field", sortField);
    return `/dashboard/clusters/${encodeURIComponent(cluster)}?${params.toString()}`;
  });
  const currentPinnedTabId = $derived(`${cluster}::${currentWorkload}::${sortField}`);
  const currentPinnedTabLabel = $derived.by(() => {
    const raw = currentWorkload || "overview";
    if (raw in WORKLOAD_LABEL_OVERRIDES) return WORKLOAD_LABEL_OVERRIDES[raw];
    return raw
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ");
  });
  const pinnedTabsForCluster = $derived(
    pinnedTabs.filter((tab) => tab.clusterId === cluster).sort((a, b) => b.pinnedAt - a.pinnedAt),
  );
  const isCurrentTabPinned = $derived(
    pinnedTabs.some((tab) => tab.id === currentPinnedTabId && tab.clusterId === cluster),
  );
  const workspaceLayoutMode = $derived(isCurrentTabPinned ? "pinned" : "temporary");
  const workspaceModeLabel = $derived(
    isCurrentTabPinned ? "Pinned workspace" : "Unsaved workspace",
  );
  const effectiveWorkspaceLayout = $derived(
    isCurrentTabPinned ? workspaceLayout : transientWorkspaceLayout,
  );
  const restorablePinnedTab = $derived.by(() => {
    if (isCurrentTabPinned) return null;
    for (const tab of pinnedTabsForCluster) {
      const session = pinnedWorkspaceSessions[tab.id];
      if (session && session.layout > 1) return tab;
    }
    return null;
  });
  const pane2Data = $derived(pane2Workloads.data);
  const pane2Loading = $derived(pane2Workloads.isLoading);
  const pane2Error = $derived(pane2Workloads.error);
  const pane3Data = $derived(pane3Workloads.data);
  const pane3Loading = $derived(pane3Workloads.isLoading);
  const pane3Error = $derived(pane3Workloads.error);
  const workspaceGridClass = $derived.by(() => {
    if (effectiveWorkspaceLayout === 1) return "grid-cols-1";
    if (effectiveWorkspaceLayout === 2) return "grid-cols-1 xl:grid-cols-2";
    return "grid-cols-1 xl:grid-cols-3";
  });
  const shouldShowPodsSyncStatus = $derived(routeWorkloadType === "pods");
  const shouldShowOverviewSyncStatus = $derived(routeWorkloadType === "overview");
  const shouldShowDeploymentsSyncStatus = $derived(routeWorkloadType === "deployments");
  const shouldShowDaemonSetsSyncStatus = $derived(routeWorkloadType === "daemonsets");
  const shouldShowStatefulSetsSyncStatus = $derived(routeWorkloadType === "statefulsets");
  const shouldShowReplicaSetsSyncStatus = $derived(routeWorkloadType === "replicasets");
  const shouldShowJobsSyncStatus = $derived(routeWorkloadType === "jobs");
  const shouldShowCronJobsSyncStatus = $derived(routeWorkloadType === "cronjobs");
  const shouldShowNodesStatusSync = $derived(routeWorkloadType === "nodesstatus");
  const shouldShowConfigurationSyncStatus = $derived(configurationWorkloads.has(routeWorkloadType));
  const shouldShowHeaderSyncBadge = true;
  const podsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($podsSyncStatus);
  });
  const overviewSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($overviewSyncStatus);
  });
  const deploymentsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($deploymentsSyncStatus);
  });
  const daemonSetsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($daemonSetsSyncStatus);
  });
  const statefulSetsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($statefulSetsSyncStatus);
  });
  const replicaSetsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($replicaSetsSyncStatus);
  });
  const jobsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($jobsSyncStatus);
  });
  const cronJobsSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($cronJobsSyncStatus);
  });
  const nodesStatusSyncText = $derived.by(() => {
    return deriveSyncStateText($nodesHealthStatus);
  });
  const configurationSyncStatusText = $derived.by(() => {
    return deriveSyncStateText($configurationSyncStatus);
  });
  const headerSyncStatus = $derived.by(() => {
    if (!shouldShowHeaderSyncBadge) return null;
    if (shouldShowOverviewSyncStatus) return $overviewSyncStatus;
    if (shouldShowPodsSyncStatus) return $podsSyncStatus;
    if (shouldShowDeploymentsSyncStatus) return $deploymentsSyncStatus;
    if (shouldShowDaemonSetsSyncStatus) return $daemonSetsSyncStatus;
    if (shouldShowStatefulSetsSyncStatus) return $statefulSetsSyncStatus;
    if (shouldShowReplicaSetsSyncStatus) return $replicaSetsSyncStatus;
    if (shouldShowJobsSyncStatus) return $jobsSyncStatus;
    if (shouldShowCronJobsSyncStatus) return $cronJobsSyncStatus;
    if (shouldShowConfigurationSyncStatus) return $configurationSyncStatus;
    if (shouldShowNodesStatusSync) return $nodesHealthStatus;
    return null;
  });
  const headerSyncStatusText = $derived.by(() => {
    return headerSyncStatus ? deriveSyncStateText(headerSyncStatus) : "empty";
  });
  const headerSyncLastUpdatedAt = $derived.by(() => {
    if (!shouldShowHeaderSyncBadge) return null;
    if (shouldShowOverviewSyncStatus) return $overviewSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowPodsSyncStatus) return $podsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowDeploymentsSyncStatus) return $deploymentsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowDaemonSetsSyncStatus) return $daemonSetsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowStatefulSetsSyncStatus) return $statefulSetsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowReplicaSetsSyncStatus) return $replicaSetsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowJobsSyncStatus) return $jobsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowCronJobsSyncStatus) return $cronJobsSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowConfigurationSyncStatus) return $configurationSyncStatus.lastUpdatedAt ?? null;
    if (shouldShowNodesStatusSync) return $nodesHealthStatus.lastUpdatedAt ?? null;
    return null;
  });
  const headerSyncDisplayUpdatedAt = $derived.by(() => {
    return headerSyncLastUpdatedAt ?? workloads.cache.cachedAt ?? null;
  });
  const headerSyncDisplayText = $derived.by(() => {
    if (headerSyncStatusText === "empty" && headerSyncDisplayUpdatedAt) return "updated";
    return headerSyncStatusText;
  });
  const headerSyncDisplayEnabled = $derived.by(() => {
    return headerSyncStatus?.enabled ?? Boolean(headerSyncDisplayUpdatedAt);
  });
  const shouldTickRelativeTime = $derived.by(() => {
    return Boolean(headerSyncDisplayUpdatedAt);
  });

  onMount(() => {
    stopClusterDetailBackgroundPollers(cluster);
    clusterName = findClusterByUuid(cluster)?.name;

    if (!clusterName) {
      void loadClusters()
        .then(() => {
          clusterName = findClusterByUuid(cluster)?.name;
        })
        .catch((err) => {
          Sentry.captureException(err);
        });
    }

    if (!cluster) {
      Sentry.captureException("Cluster not found");
      return;
    }

    if (!$selectedNamespace) {
      const clusterConfig = findClusterByUuid(cluster);
      if (clusterConfig?.defaultNamespace) {
        applyDefaultNamespace(cluster, clusterConfig.defaultNamespace);
      } else {
        setSelectedNamespace(cluster, "all");
      }
    }

    if (typeof window !== "undefined") {
      workspaceHydrationTimeout = setTimeout(() => {
        workspaceHydrationTimeout = null;
        const startedAt = performance.now();
        const hydratedPinnedTabs = readPinnedTabs(PINNED_CLUSTER_TABS_KEY);
        const isHydratedRoutePinned = hydratedPinnedTabs.some(
          (tab) => tab.id === currentPinnedTabId && tab.clusterId === cluster,
        );
        pinnedTabs = hydratedPinnedTabs;
        pinnedTabsHydrated = true;
        workspaceLayout = readWorkspaceLayout(WORKSPACE_LAYOUT_KEY);
        transientWorkspaceLayout = workspaceLayout;
        workspacePanes = normalizeWorkspacePanes(
          readWorkspacePanes(WORKSPACE_PANES_KEY, createDefaultWorkspacePanes()),
        );
        pinnedWorkspaceSessions = readPinnedWorkspaceSessions(
          PINNED_WORKSPACE_SESSIONS_KEY,
          createDefaultWorkspacePanes(),
          cluster,
          sortField || "name",
          createPaneTab,
        );
        if (ENABLE_WORKSPACE_DEBUG_PANEL) {
          debugLogsEnabled = window.localStorage.getItem(DEBUG_LOGS_ENABLED_KEY) === "1";
          debugLogs = appendDebugLog(
            debugLogs,
            "info",
            `Workspace hydration completed in ${(performance.now() - startedAt).toFixed(1)}ms`,
          );
        }
        workspaceHydrated = true;
      }, 0);
    }
  });

  onDestroy(() => {
    if (workspaceHydrationTimeout) {
      clearTimeout(workspaceHydrationTimeout);
      workspaceHydrationTimeout = null;
    }
    stopClusterDetailBackgroundPollers(cluster);
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!shouldTickRelativeTime) return;
    const lastUpdatedAt = headerSyncDisplayUpdatedAt;
    if (!lastUpdatedAt) return;
    let timer: number | null = null;
    const scheduleNextTick = () => {
      const delayMs = resolveRelativeTickMs(lastUpdatedAt);
      timer = window.setTimeout(() => {
        relativeTimeTick = Date.now();
        scheduleNextTick();
      }, delayMs);
    };
    scheduleNextTick();
    return () => {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = null;
    };
  });

  function pushDebugLog(level: "info" | "warn" | "error", message: string) {
    if (!ENABLE_WORKSPACE_DEBUG_PANEL || !debugLogsEnabled) return;
    debugLogs = appendDebugLog(debugLogs, level, message);
  }

  function setDebugLogsEnabled(next: boolean) {
    debugLogsEnabled = next;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEBUG_LOGS_ENABLED_KEY, next ? "1" : "0");
    }
  }

  function clearDebugLogs() {
    debugLogs = [];
  }

  function buildCurrentPinnedTab(): PinnedClusterTab {
    return {
      id: currentPinnedTabId,
      clusterId: cluster,
      workload: currentWorkload || "overview",
      sortField: sortField || "name",
      label: currentPinnedTabLabel || "Overview",
      href: currentTabHref,
      pinnedAt: Date.now(),
    };
  }

  async function shouldConfirmPinnedRemoval(tabId: string): Promise<boolean> {
    const session = pinnedWorkspaceSessions[tabId];
    if (!session || session.layout < 2) return false;
    const confirmed = await confirmAction(
      "This pinned tab has a saved split workspace (Pane 2/3). Remove pin and saved workspace session?",
      "Remove pinned workspace",
    );
    return !confirmed;
  }

  async function togglePinCurrentTab() {
    const existing = pinnedTabs.find(
      (tab) => tab.id === currentPinnedTabId && tab.clusterId === cluster,
    );
    let next: PinnedClusterTab[];

    if (existing) {
      if (await shouldConfirmPinnedRemoval(currentPinnedTabId)) return;
      next = pinnedTabs.filter(
        (tab) => !(tab.id === currentPinnedTabId && tab.clusterId === cluster),
      );
      const remainingSessions = { ...pinnedWorkspaceSessions };
      delete remainingSessions[currentPinnedTabId];
      pinnedWorkspaceSessions = remainingSessions;
      savePinnedWorkspaceSessions(PINNED_WORKSPACE_SESSIONS_KEY, remainingSessions);
      toast.info("Page unpinned", { duration: 3000 });
    } else {
      const current = buildCurrentPinnedTab();
      const withoutDuplicate = pinnedTabs.filter(
        (tab) => !(tab.id === current.id && tab.clusterId === current.clusterId),
      );
      next = [current, ...withoutDuplicate].slice(0, MAX_PINNED_CLUSTER_TABS);
      persistPinnedWorkspaceSession(current.id);
      toast.success("Page pinned", {
        description: "Workspace layout will be remembered.",
        duration: 3000,
      });
    }

    pinnedTabs = next;
    savePinnedTabs(PINNED_CLUSTER_TABS_KEY, next);
  }

  async function removePinnedTab(tabId: string) {
    if (await shouldConfirmPinnedRemoval(tabId)) return;
    const next = pinnedTabs.filter((tab) => tab.id !== tabId);
    pinnedTabs = next;
    savePinnedTabs(PINNED_CLUSTER_TABS_KEY, next);
    const remainingSessions = { ...pinnedWorkspaceSessions };
    delete remainingSessions[tabId];
    pinnedWorkspaceSessions = remainingSessions;
    savePinnedWorkspaceSessions(PINNED_WORKSPACE_SESSIONS_KEY, remainingSessions);
  }

  function openPinnedTab(tab: PinnedClusterTab) {
    goto(tab.href);
  }

  function openRestorablePinnedTab() {
    if (!restorablePinnedTab) return;
    void goto(restorablePinnedTab.href);
  }

  async function gotoFromWorkspace(href: string) {
    preserveNextSinglePaneReset = true;
    nextNavigationSource = "workspace";
    try {
      await goto(href);
    } catch (error) {
      preserveNextSinglePaneReset = false;
      nextNavigationSource = null;
      throw error;
    }
  }

  async function handleClusterSelectionChange(nextClusterId: string) {
    if (!nextClusterId || nextClusterId === cluster || clusterSwitchInFlight) return;
    clusterSwitchInFlight = true;
    pushDebugLog("info", `Cluster switch -> ${nextClusterId}`);
    const nextWorkload = routeWorkloadType || "overview";
    if (nextWorkload !== "overview") {
      void prefetchWorkloadSnapshots({
        workloadTypes: CLUSTER_SWITCH_PREFETCH_WORKLOADS,
        namespace: "all",
        clusterUuid: nextClusterId,
        sortField: "name",
        maxConcurrent: clusterSwitchPrefetchMaxConcurrent,
      });
    }
    try {
      await gotoFromWorkspace(
        toClusterWorkloadHref(nextWorkload, sortField || "name", nextClusterId),
      );
    } catch (error) {
      pushDebugLog(
        "error",
        `Cluster switch failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      clusterSwitchInFlight = false;
    }
  }

  function openPinnedTabInPane(paneId: WorkspacePaneId, tab: PinnedClusterTab) {
    openWorkloadInPane(paneId, toPinnedWorkloadType(tab.workload), tab.clusterId);
  }

  function createPaneTab(
    clusterId: string,
    workload: WorkloadType,
    sortField: string,
  ): WorkspacePaneTab {
    return createWorkspacePaneTab(
      clusterId,
      workload,
      sortField,
      (nextClusterId) => findClusterByUuid(nextClusterId)?.name || nextClusterId,
    );
  }

  function persistPinnedWorkspaceSession(tabId: string) {
    if (!tabId) return;
    const nextSessions = {
      ...pinnedWorkspaceSessions,
      [tabId]: {
        layout: effectiveWorkspaceLayout,
        panes: cloneWorkspacePanes(workspacePanes),
      },
    };
    pinnedWorkspaceSessions = nextSessions;
    savePinnedWorkspaceSessions(PINNED_WORKSPACE_SESSIONS_KEY, nextSessions);
  }

  function setWorkspaceLayout(next: WorkspaceLayout) {
    if (isCurrentTabPinned) {
      workspaceLayout = next;
      saveWorkspaceLayout(WORKSPACE_LAYOUT_KEY, next);
      persistPinnedWorkspaceSession(currentPinnedTabId);
      return;
    }
    transientWorkspaceLayout = next;
    saveWorkspaceLayout(WORKSPACE_LAYOUT_KEY, next);
  }

  function normalizeWorkspacePanes(next: Record<WorkspacePaneId, WorkspacePaneState>) {
    return normalizeStoredWorkspacePanes(next, cluster, sortField || "name", createPaneTab);
  }

  function updatePaneState(paneId: WorkspacePaneId, patch: Partial<WorkspacePaneState>) {
    const next = {
      ...workspacePanes,
      [paneId]: { ...workspacePanes[paneId], ...patch },
    };
    workspacePanes = next;
    saveWorkspacePanes(WORKSPACE_PANES_KEY, next);
    if (isCurrentTabPinned) {
      persistPinnedWorkspaceSession(currentPinnedTabId);
    }
  }

  function openWorkloadInPane(
    paneId: WorkspacePaneId,
    workload: WorkloadType = "overview",
    clusterIdOverride?: string,
  ) {
    const current = workspacePanes[paneId];
    const sort = current.sortField || "name";
    const paneClusterId = clusterIdOverride || current.clusterId || cluster;
    const tab = createPaneTab(paneClusterId, workload, sort);

    if (paneId === "pane-1") {
      void gotoFromWorkspace(toClusterWorkloadHref(tab.workload, tab.sortField, tab.clusterId));
      return;
    }

    const tabs = buildPaneTabList(tab, current.tabs, WORKSPACE_MAX_TABS_PER_PANE);
    updatePaneState(paneId, {
      clusterId: paneClusterId,
      workload,
      tabs,
      activeTabId: tab.id,
    });
  }

  function setPaneWorkload(paneId: WorkspacePaneId, workload: WorkloadType) {
    const pane = workspacePanes[paneId];
    const paneClusterId = pane.clusterId || cluster;
    const tab = createPaneTab(paneClusterId, workload, pane.sortField || "name");

    if (paneId === "pane-1") {
      void gotoFromWorkspace(toClusterWorkloadHref(tab.workload, tab.sortField, tab.clusterId));
      return;
    }

    preserveNextSinglePaneReset = true;
    updatePaneState(
      paneId,
      buildSecondaryPaneState({
        pane,
        nextTab: tab,
        tabs: buildPaneTabList(tab, pane.tabs, WORKSPACE_MAX_TABS_PER_PANE),
      }),
    );
  }

  function setPaneCluster(paneId: WorkspacePaneId, clusterId: string) {
    if (!clusterId) return;
    if (paneId === "pane-1") {
      void handleClusterSelectionChange(clusterId);
      return;
    }
    preserveNextSinglePaneReset = true;
    const pane = workspacePanes[paneId];
    const tab = createPaneTab(clusterId, pane.workload, pane.sortField || "name");
    updatePaneState(
      paneId,
      buildSecondaryPaneState({
        pane,
        nextTab: tab,
        tabs: buildPaneTabList(tab, pane.tabs, WORKSPACE_MAX_TABS_PER_PANE),
      }),
    );
  }

  function openPaneTab(paneId: WorkspacePaneId, tabId: string) {
    const pane = workspacePanes[paneId];
    const tab = findPaneTab(pane, tabId);
    if (!tab) return;

    if (paneId === "pane-1") {
      void gotoFromWorkspace(
        toClusterWorkloadHref(tab.workload, tab.sortField || "name", tab.clusterId),
      );
      return;
    }

    updatePaneState(paneId, {
      clusterId: tab.clusterId,
      workload: tab.workload,
      sortField: tab.sortField,
      activeTabId: tab.id,
    });
  }

  function closePaneTab(paneId: WorkspacePaneId, tabId: string) {
    const pane = workspacePanes[paneId];
    const {
      nextTabs,
      nextActive,
      nextState: nextPaneState,
    } = buildClosedPaneState({
      paneId,
      pane,
      tabId,
      fallbackClusterId: cluster,
      fallbackWorkload: routeWorkloadType ?? "overview",
      fallbackSortField: sortField ?? "name",
    });

    if (paneId === "pane-1") {
      const nextState = {
        ...workspacePanes,
        "pane-1": {
          ...pane,
          ...nextPaneState,
        },
      };
      workspacePanes = nextState;
      saveWorkspacePanes(WORKSPACE_PANES_KEY, nextState);
      if (isCurrentTabPinned) {
        persistPinnedWorkspaceSession(currentPinnedTabId);
      }

      if (tabId === pane.activeTabId && nextActive) {
        void gotoFromWorkspace(
          toClusterWorkloadHref(nextActive.workload, nextActive.sortField, nextActive.clusterId),
        );
      }
      return;
    }

    updatePaneState(paneId, nextPaneState);
  }

  function buildPanePageData(pane: WorkspacePaneState): PageData {
    return buildPanePageDataModel(
      pane,
      cluster,
      (clusterId) => findClusterByUuid(clusterId)?.name || clusterId,
    );
  }

  function paneWorkloadData(paneId: WorkspacePaneId): unknown {
    if (paneId === "pane-2") return pane2Data;
    return pane3Data;
  }

  function paneLoading(paneId: WorkspacePaneId): boolean {
    if (paneId === "pane-2") return pane2Loading;
    return pane3Loading;
  }

  function paneError(paneId: WorkspacePaneId): string | null {
    if (paneId === "pane-2") return pane2Error;
    return pane3Error;
  }

  function paneIndexLabel(paneId: WorkspacePaneId): string {
    return resolvePaneIndexLabel(paneId);
  }

  function paneHasEffectiveData(paneId: WorkspacePaneId): boolean {
    return derivePaneHasEffectiveData({
      paneId,
      pane: workspacePanes[paneId],
      isPrimaryPaneRenderable: hasEffectiveWorkloadData,
      workloadData: paneWorkloadData(paneId),
    });
  }

  function paneStatusLabel(paneId: WorkspacePaneId): "loading" | "error" | "ready" {
    const hasData = paneHasEffectiveData(paneId);
    return derivePaneStatusLabel({
      paneId,
      hasData,
      isPrimaryLoading: isLoading,
      isPrimaryError: Boolean(errorMessage),
      paneLoading: paneLoading(paneId),
      paneError: Boolean(paneError(paneId)),
    });
  }

  function paneStatusClass(paneId: WorkspacePaneId): string {
    return resolvePaneStatusClass(paneStatusLabel(paneId));
  }

  function syncBadgeTone(workload: WorkloadType, clusterId: string = cluster): string {
    const status = readWorkloadSyncStatus(workload, clusterId);
    return resolveSyncBadgeTone(status);
  }

  function syncBadgeText(workload: WorkloadType, clusterId: string = cluster): string {
    const status = readWorkloadSyncStatus(workload, clusterId);
    return formatSyncBadgeText(status as GenericSyncStatus | null, (updatedAt) =>
      timeAgo(new Date(updatedAt)),
    );
  }

  function workspaceLayoutBadge(tabId: string): string {
    return resolveWorkspaceLayoutBadge(pinnedWorkspaceSessions[tabId]?.layout);
  }

  function showSinglePageHintOnce() {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(SINGLE_PAGE_HINT_SHOWN_KEY) === "1") return;
    window.localStorage.setItem(SINGLE_PAGE_HINT_SHOWN_KEY, "1");
    toast("You are viewing a standalone page. Return to a pinned tab to restore panes.");
  }

  function pushRouteTrace(source: "left_menu" | "workspace" | "unknown") {
    const entry = buildRouteTraceEntry({
      cluster,
      workload: routeWorkloadType || "overview",
      sortField: sortField || "name",
      namespace: resolvedWorkloadNamespace || "all",
      source,
      layoutMode: workspaceLayoutMode as "pinned" | "temporary",
    });
    workspaceRouteTrace = appendRouteTrace(workspaceRouteTrace, entry, WORKSPACE_ROUTE_TRACE_LIMIT);
  }

  function formatSyncUpdatedAt(lastUpdatedAt: number, live = true): string {
    if (live) {
      // Keep relative timestamps live even without store changes.
      const tick = relativeTimeTick;
      void tick;
    }
    return formatRelativeSyncUpdatedAt(lastUpdatedAt, getTimeDifference);
  }

  function runtimeStateTone(state: string) {
    if (state === "active") return "bg-emerald-600 text-white";
    if (state === "warm") return "bg-sky-600 text-white";
    if (state === "background") return "bg-slate-500 text-white";
    if (state === "degraded") return "bg-amber-600 text-white";
    return "bg-rose-600 text-white";
  }

  async function copyWorkspaceDebugState() {
    if (!ENABLE_WORKSPACE_DEBUG_PANEL) return;
    if (typeof window === "undefined") return;
    const snapshot = buildWorkspaceDebugSnapshot({
      cluster,
      layout: workspaceLayout,
      workload: routeWorkloadType || "overview",
      sortField: sortField || "name",
      namespace: resolvedWorkloadNamespace || "all",
      panes: workspacePanes,
      paneStatusLabel,
    });

    const payload = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      copiedDebugState = true;
      pushDebugLog("info", "Copied debug snapshot to clipboard");
      window.setTimeout(() => {
        copiedDebugState = false;
      }, 1200);
    } catch {
      copiedDebugState = false;
    }
  }

  async function copyWorkspaceRouteTrace() {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify(
      buildWorkspaceRouteTracePayload(cluster, workspaceRouteTrace),
      null,
      2,
    );
    try {
      await navigator.clipboard.writeText(payload);
      copiedRouteTrace = true;
      window.setTimeout(() => {
        copiedRouteTrace = false;
      }, 1200);
    } catch {
      copiedRouteTrace = false;
    }
  }

  function handlePaneTabDragStart(event: DragEvent, paneId: WorkspacePaneId, tabId: string) {
    const payload: DraggedPaneTabPayload = createDraggedPaneTabPayload(paneId, tabId);
    event.dataTransfer?.setData("application/x-workspace-tab", JSON.stringify(payload));
    event.dataTransfer?.setData("text/plain", JSON.stringify(payload));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function allowPaneTabsDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handlePaneTabsDrop(event: DragEvent, targetPaneId: WorkspacePaneId) {
    event.preventDefault();
    const raw =
      event.dataTransfer?.getData("application/x-workspace-tab") ||
      event.dataTransfer?.getData("text/plain");
    if (!raw) return;

    try {
      const payload = parseDraggedPaneTabPayload(raw);
      if (!payload) return;
      const fromPane = workspacePanes[payload.fromPaneId];
      const targetPane = workspacePanes[targetPaneId];
      if (!fromPane || !targetPane || payload.fromPaneId === targetPaneId) return;

      const tab = fromPane.tabs.find((item) => item.id === payload.tabId);
      if (!tab) return;

      const nextFromTabs = fromPane.tabs.filter((item) => item.id !== tab.id);
      const nextTargetTabs = [tab, ...targetPane.tabs.filter((item) => item.id !== tab.id)].slice(
        0,
        WORKSPACE_MAX_TABS_PER_PANE,
      );

      const next: Record<WorkspacePaneId, WorkspacePaneState> = {
        ...workspacePanes,
        [payload.fromPaneId]: {
          ...fromPane,
          tabs: nextFromTabs,
          activeTabId: nextFromTabs[0]?.id ?? null,
          clusterId: nextFromTabs[0]?.clusterId ?? fromPane.clusterId ?? cluster,
          workload: nextFromTabs[0]?.workload ?? fromPane.workload ?? "overview",
          sortField: nextFromTabs[0]?.sortField ?? fromPane.sortField ?? "name",
        },
        [targetPaneId]: {
          ...targetPane,
          tabs: nextTargetTabs,
          activeTabId: tab.id,
          clusterId: tab.clusterId,
          workload: tab.workload,
          sortField: tab.sortField,
        },
      };

      workspacePanes = next;
      saveWorkspacePanes(WORKSPACE_PANES_KEY, next);
      if (isCurrentTabPinned) {
        persistPinnedWorkspaceSession(currentPinnedTabId);
      }

      if (targetPaneId === "pane-1") {
        void gotoFromWorkspace(
          toClusterWorkloadHref(tab.workload, tab.sortField || "name", tab.clusterId),
        );
      }
    } catch {
      // ignore invalid payload
    }
  }

  let normalizedWorkspaceCluster = $state<string | null>(null);
  $effect(() => {
    if (!workspaceHydrated || !cluster) return;
    untrack(() => {
      if (normalizedWorkspaceCluster === cluster) return;
      normalizedWorkspaceCluster = cluster;
      const next = normalizeWorkspacePanes(workspacePanes);
      if (sameWorkspacePanes(workspacePanes, next)) return;
      workspacePanes = next;
      saveWorkspacePanes(WORKSPACE_PANES_KEY, next);
      if (isCurrentTabPinned) {
        persistPinnedWorkspaceSession(currentPinnedTabId);
      }
    });
  });

  let previousWorkspaceRouteKey = $state<string | null>(null);
  $effect(() => {
    if (!workspaceHydrated || !pinnedTabsHydrated || !cluster || !routeWorkloadType) return;
    const routeKey = buildWorkspaceRouteKey(cluster, routeWorkloadType, sortField || "name");
    untrack(() => {
      if (previousWorkspaceRouteKey === routeKey) return;
      previousWorkspaceRouteKey = routeKey;
      const navSource = resolveWorkspaceNavigationSource(nextNavigationSource);
      nextNavigationSource = null;
      lastNavigationSource = navSource;
      pushRouteTrace(navSource);
      if (!isCurrentTabPinned) {
        if (preserveNextSinglePaneReset || navSource === "workspace") {
          preserveNextSinglePaneReset = false;
          previousRouteWasPinned = false;
          return;
        }
        if (previousRouteWasPinned) {
          showSinglePageHintOnce();
          transientWorkspaceLayout = 1;
        }
        previousRouteWasPinned = false;
        return;
      }
      preserveNextSinglePaneReset = false;
      previousRouteWasPinned = true;

      const restorePlan = buildPinnedSessionRestore({
        session: pinnedWorkspaceSessions[currentPinnedTabId],
        workspaceLayout,
      });
      if (restorePlan.type === "persist-current") {
        persistPinnedWorkspaceSession(currentPinnedTabId);
        transientWorkspaceLayout = restorePlan.transientWorkspaceLayout;
        return;
      }

      const nextLayout = restorePlan.nextLayout;
      const nextPanes = normalizeWorkspacePanes(
        pinnedWorkspaceSessions[currentPinnedTabId]?.panes ?? workspacePanes,
      );
      const panesChanged = !sameWorkspacePanes(workspacePanes, nextPanes);
      const layoutChanged =
        workspaceLayout !== nextLayout || transientWorkspaceLayout !== nextLayout;
      if (!panesChanged && !layoutChanged) return;
      workspaceLayout = nextLayout;
      transientWorkspaceLayout = nextLayout;
      saveWorkspaceLayout(WORKSPACE_LAYOUT_KEY, nextLayout);
      if (panesChanged) {
        workspacePanes = nextPanes;
        saveWorkspacePanes(WORKSPACE_PANES_KEY, nextPanes);
      }
    });
  });

  $effect(() => {
    if (!workspaceHydrated || !pinnedTabsHydrated) return;
    const activeClusterIds = new Set(($clustersList || []).map((c) => c.uuid));
    untrack(() => {
      if (activeClusterIds.size > 0) {
        const pruned = pruneStalePins(pinnedTabs, activeClusterIds);
        if (pruned.length < pinnedTabs.length) {
          pinnedTabs = pruned;
          savePinnedTabs(PINNED_CLUSTER_TABS_KEY, pruned);
        }
      }
      const tabIds = pinnedTabs.map((tab) => tab.id);
      const { changed, nextSessions } = prunePinnedWorkspaceSessions(
        tabIds,
        pinnedWorkspaceSessions,
      );
      if (!changed) return;
      pinnedWorkspaceSessions = nextSessions;
      savePinnedWorkspaceSessions(PINNED_WORKSPACE_SESSIONS_KEY, nextSessions);
    });
  });

  $effect(() => {
    if (!workspaceHydrated || !cluster || !routeWorkloadType) return;
    const _sortField = sortField;
    untrack(() => {
      const current = workspacePanes["pane-1"];
      const routeTab = createPaneTab(
        cluster,
        routeWorkloadType,
        _sortField || current.sortField || "name",
      );
      const { same, nextState: nextPaneState } = buildPrimaryPaneRouteState({
        current,
        routeTab,
        maxTabs: WORKSPACE_MAX_TABS_PER_PANE,
      });
      if (same) return;

      const next = {
        ...workspacePanes,
        "pane-1": nextPaneState,
      };
      if (sameWorkspacePanes(workspacePanes, next)) return;

      workspacePanes = next;
      saveWorkspacePanes(WORKSPACE_PANES_KEY, next);
      if (isCurrentTabPinned) {
        persistPinnedWorkspaceSession(currentPinnedTabId);
      }
    });
  });

  let previousRouteLogKey = $state<string | null>(null);
  $effect(() => {
    if (!ENABLE_WORKSPACE_DEBUG_PANEL || !workspaceHydrated) return;
    const key = buildRouteDebugKey(
      routeWorkloadType,
      sortField || "name",
      resolvedWorkloadNamespace || "all",
    );
    if (previousRouteLogKey === key) return;
    previousRouteLogKey = key;
    pushDebugLog(
      "info",
      `Route -> workload=${routeWorkloadType} sort=${sortField} ns=${resolvedWorkloadNamespace}`,
    );
  });

  let previousOverviewSyncKey = $state<string | null>(null);
  $effect(() => {
    if (!ENABLE_WORKSPACE_DEBUG_PANEL || !workspaceHydrated || routeWorkloadType !== "overview")
      return;
    const status = $overviewSyncStatus;
    const key = `${status.isLoading}|${status.error ?? ""}|${status.partialMessage ?? ""}|${status.lastUpdatedAt ?? 0}`;
    if (previousOverviewSyncKey === key) return;
    previousOverviewSyncKey = key;
    const event = buildOverviewSyncDebugEvent(status);
    if (event) pushDebugLog(event.level, event.message);
  });
</script>

<div class="cluster-page">
  <div
    class="cluster-sticky-shell sticky top-0 z-30 mb-3 rounded-lg border border-border/60 bg-background/95 px-3 pb-2 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4 sm:pb-3"
  >
    <header class="cluster-page__header mb-0">
      <div
        class="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
      >
        <h1
          class="cluster-page__title min-w-0 truncate text-lg font-bold sm:text-xl lg:flex-1"
          data-cluster={clusterName}
          title={data?.title.replace(cluster, clusterName || cluster)}
        >
          {data?.title.replace(cluster, clusterName || cluster)}
        </h1>
        <div
          class="flex flex-wrap items-center gap-2 pt-0.5 sm:gap-3 lg:min-w-0 lg:flex-nowrap lg:justify-end"
        >
          {#if workspaceHydrated}
            <div class="flex items-center gap-1">
              <Button
                variant={effectiveWorkspaceLayout === 1 ? "secondary" : "ghost"}
                class="h-8 px-2 text-xs"
                type="button"
                onclick={() => setWorkspaceLayout(1)}
                title="Single pane - one workload view"
                aria-label="Single pane layout"
              >
                1
              </Button>
              <Button
                variant={effectiveWorkspaceLayout === 2 ? "secondary" : "ghost"}
                class="h-8 px-2 text-xs"
                type="button"
                onclick={() => setWorkspaceLayout(2)}
                title="Dual pane - view two workloads side by side. Each pane can show a different cluster."
                aria-label="Dual pane layout"
              >
                2
              </Button>
              <Button
                variant={effectiveWorkspaceLayout === 3 ? "secondary" : "ghost"}
                class="h-8 px-2 text-xs"
                type="button"
                onclick={() => setWorkspaceLayout(3)}
                title="Triple pane - view three workloads simultaneously. Each pane can show a different cluster."
                aria-label="Triple pane layout"
              >
                3
              </Button>
            </div>
            <span
              class={`rounded border px-2 py-0.5 text-[11px] ${
                workspaceLayoutMode === "pinned"
                  ? "border-green-600/40 text-green-700 dark:text-green-400"
                  : "border-amber-600/40 text-amber-700 dark:text-amber-400"
              }`}
              title={workspaceLayoutMode === "pinned"
                ? "Pinned workspace remembers pane layout and tabs."
                : "Unsaved workspace - pin this page to remember pane layout and tabs across navigation."}
            >
              {workspaceModeLabel}
            </span>
            {#if restorablePinnedTab}
              <Button
                variant="ghost"
                class="h-8 px-2 text-xs text-muted-foreground"
                type="button"
                onclick={openRestorablePinnedTab}
                title={`Restore ${restorablePinnedTab.label} workspace layout`}
              >
                Restore pinned layout
              </Button>
            {/if}
          {/if}
          <Button
            variant="ghost"
            class="text-sm"
            type="button"
            onclick={() => {
              void togglePinCurrentTab();
            }}
            title={isCurrentTabPinned ? "Unpin this page" : "Pin this page"}
          >
            {#if isCurrentTabPinned}
              <PinOff class="h-4 w-4" />
            {:else}
              <Pin class="h-4 w-4" />
            {/if}
          </Button>
          <Button
            variant="ghost"
            class="text-sm uppercase tracking-wide text-muted-foreground"
            type="button"
            disabled={hasActiveDebugShell}
            onclick={() => openShellModal(data.slug)}
            title={hasActiveDebugShell ? "Terminal is already open" : "Open terminal"}
          >
            >_ Terminal
          </Button>
          <Popover.Root>
            <Popover.Trigger
              class="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1 sm:h-9 sm:px-3"
              type="button"
              title="Open cluster runtime controls"
            >
              <span class="font-medium text-foreground">Runtime</span>
              <Badge class={runtimeStateTone(clusterRuntimeState)}>{clusterRuntimeState}</Badge>
              <span class="hidden text-[11px] text-muted-foreground xl:inline">
                {clusterRuntimeBudgetSummary}
              </span>
            </Popover.Trigger>
            <Popover.Content class="w-[392px]" sideOffset={8} align="end">
              <div class="mb-3 flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <div class="text-sm font-medium">Cluster runtime</div>
                  <div class="text-xs text-muted-foreground">
                    {clusterRuntimeProfileSummary} · {clusterRuntimeBudget.networkSensitivity} network
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Effective budget: {clusterRuntimeBudgetSummary}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    Adaptive connectivity:
                    {#if adaptiveConnectivityState.active}
                      degraded · {adaptiveConnectivityState.recommendedSensitivity} lane
                    {:else}
                      healthy
                    {/if}
                  </div>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <Badge class={runtimeStateTone(clusterRuntimeState)}>{clusterRuntimeState}</Badge>
                  <span class="text-[11px] text-muted-foreground">
                    {#if clusterRuntimeOverride}
                      Override active
                    {:else}
                      Inheriting shared profile
                    {/if}
                  </span>
                </div>
              </div>
              <div class="mb-3 text-xs text-muted-foreground">
                {adaptiveConnectivityState.reason}
              </div>
              <ClusterRuntimeTuningPanel clusterId={cluster} />
            </Popover.Content>
          </Popover.Root>
          <Popover.Root>
            <Popover.Trigger
              class="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1 sm:h-9 sm:px-3"
              type="button"
              title="Open request and debug inspector"
            >
              <span class="font-medium text-foreground">Inspector</span>
              <span class="hidden text-[11px] text-muted-foreground xl:inline">
                {clusterRequestInspector.summary.degradedEvents} degraded
              </span>
            </Popover.Trigger>
            <Popover.Content class="w-[472px]" sideOffset={8} align="end">
              <ClusterRequestDebugInspector
                summary={clusterRequestInspector.summary}
                rows={clusterRequestInspector.rows}
                formatAt={(value) => (value ? formatSyncUpdatedAt(value, true) : "n/a")}
              />
            </Popover.Content>
          </Popover.Root>
          {#if shouldShowHeaderSyncBadge && (headerSyncStatus || headerSyncDisplayUpdatedAt)}
            <div
              class="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums text-gray-500 dark:text-gray-400"
            >
              {#if headerSyncDisplayText === "error"}
                <span class="text-red-500">● Error</span>
              {:else if headerSyncDisplayText === "partial" && headerSyncDisplayUpdatedAt}
                <span class="text-amber-600 dark:text-amber-400">
                  ● Partial {formatSyncUpdatedAt(
                    headerSyncDisplayUpdatedAt,
                    headerSyncDisplayEnabled,
                  )}
                </span>
              {:else if headerSyncDisplayText === "loading"}
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block h-2 w-2 animate-spin rounded-full border-2 border-current border-t-transparent"
                    aria-hidden="true"
                  ></span>
                  Updating
                </span>
              {:else if headerSyncDisplayText === "updated"}
                <span
                  class={headerSyncDisplayEnabled
                    ? "text-green-600 dark:text-green-400"
                    : "text-gray-500 dark:text-gray-400"}
                >
                  ● {headerSyncDisplayUpdatedAt
                    ? formatSyncUpdatedAt(headerSyncDisplayUpdatedAt, headerSyncDisplayEnabled)
                    : "just now"}
                </span>
              {/if}
            </div>
          {/if}
          {#if ENABLE_WORKSPACE_DEBUG_PANEL && workspaceHydrated}
            <Button
              variant="ghost"
              class="h-8 px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground sm:h-9"
              type="button"
              onclick={copyWorkspaceDebugState}
              title="Copy debug snapshot"
            >
              {copiedDebugState ? "Copied" : "Debug"}
            </Button>
          {/if}
        </div>
      </div>
      {#if clusterTrustBanner}
        <div class={`mt-3 rounded-lg border px-4 py-3 text-sm ${clusterTrustBanner.tone}`}>
          <div class="font-medium">{clusterTrustBanner.title}</div>
          <div class="mt-1 text-xs opacity-90">{clusterTrustBanner.detail}</div>
        </div>
      {/if}
    </header>

    {#if pinnedTabsHydrated && pinnedTabsForCluster.length > 0}
      <div class="mb-3 flex flex-wrap items-center gap-2">
        {#each pinnedTabsForCluster as tab (tab.id)}
          <div
            class={`inline-flex items-center rounded-md border border-border bg-muted/30 ${
              tab.id === currentPinnedTabId ? "ring-1 ring-primary" : ""
            }`}
          >
            <button
              type="button"
              class="px-3 py-1.5 text-xs hover:bg-muted/70"
              class:font-semibold={tab.id === currentPinnedTabId}
              onclick={() => openPinnedTab(tab)}
              title={tab.label}
            >
              {tab.label}
              <span
                class="ml-1 rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground"
              >
                {workspaceLayoutBadge(tab.id)}
              </span>
            </button>
            {#if workspaceHydrated && effectiveWorkspaceLayout >= 2}
              <div class="mr-1 flex items-center gap-1 border-l border-border pl-1">
                <button
                  type="button"
                  class="rounded px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  onclick={() => openPinnedTab(tab)}
                  title="Open in Pane 1"
                  aria-label={`Open ${tab.label} in Pane 1`}
                >
                  1
                </button>
                <button
                  type="button"
                  class="rounded px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  onclick={() => openPinnedTabInPane("pane-2", tab)}
                  title="Open in Pane 2"
                  aria-label={`Open ${tab.label} in Pane 2`}
                >
                  2
                </button>
                {#if effectiveWorkspaceLayout >= 3}
                  <button
                    type="button"
                    class="rounded px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                    onclick={() => openPinnedTabInPane("pane-3", tab)}
                    title="Open in Pane 3"
                    aria-label={`Open ${tab.label} in Pane 3`}
                  >
                    3
                  </button>
                {/if}
              </div>
            {/if}
            <button
              type="button"
              class="px-2 py-1.5 text-muted-foreground hover:text-foreground"
              onclick={() => {
                void removePinnedTab(tab.id);
              }}
              title="Remove pinned tab"
              aria-label={`Remove pinned tab ${tab.label}`}
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    {#if $namespaces && isNamespaceScoped}
      <div class="cluster-page__controls mb-0">
        <NamespaceSelect clusterId={data.slug} />
      </div>
    {/if}
  </div>

  {#if ENABLE_WORKSPACE_DEBUG_PANEL && workspaceHydrated}
    <div class="mb-3 rounded-md border border-border bg-muted/20 p-2">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="text-xs font-semibold text-muted-foreground">Debug Logs</div>
        <div class="flex items-center gap-2">
          <Button
            variant={debugLogsEnabled ? "secondary" : "ghost"}
            class="h-7 px-2 text-xs"
            type="button"
            onclick={() => setDebugLogsEnabled(!debugLogsEnabled)}
            title="Toggle debug logs"
          >
            {debugLogsEnabled ? "Logs: ON" : "Logs: OFF"}
          </Button>
          <Button
            variant="ghost"
            class="h-7 px-2 text-xs"
            type="button"
            onclick={clearDebugLogs}
            title="Clear logs"
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            class="h-7 px-2 text-xs"
            type="button"
            onclick={copyWorkspaceRouteTrace}
            title="Copy route trace"
          >
            {copiedRouteTrace ? "Trace Copied" : "Copy Route Trace"}
          </Button>
        </div>
      </div>
      <div
        class="mb-2 flex flex-wrap items-center gap-3 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground"
      >
        <span>nav_source: {lastNavigationSource}</span>
        <span>layout_mode: {workspaceLayoutMode}</span>
      </div>
      <div
        class="mb-2 grid gap-1 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground sm:grid-cols-3"
      >
        <span>workload events: {workloadTelemetrySummary.sampleSize}</span>
        <span
          >cache hit/stale: {workloadTelemetrySummary.cacheHits}/{workloadTelemetrySummary.staleHits}</span
        >
        <span>
          refresh p50/p95/p99:
          {workloadTelemetrySummary.refreshP50 !== null
            ? `${workloadTelemetrySummary.refreshP50}/${workloadTelemetrySummary.refreshP95}/${workloadTelemetrySummary.refreshP99}ms`
            : "n/a"}
        </span>
        <span>
          scheduler wait p50/p95/p99:
          {workloadTelemetrySummary.schedulerWaitP50 !== null
            ? `${workloadTelemetrySummary.schedulerWaitP50}/${workloadTelemetrySummary.schedulerWaitP95}/${workloadTelemetrySummary.schedulerWaitP99}ms`
            : "n/a"}
        </span>
        <span>
          render p50/p95/p99:
          {workloadTelemetrySummary.viewRenderP50 !== null
            ? `${workloadTelemetrySummary.viewRenderP50}/${workloadTelemetrySummary.viewRenderP95}/${workloadTelemetrySummary.viewRenderP99}ms`
            : "n/a"}
        </span>
        <span>
          telemetry last:
          {workloadTelemetrySummary.lastEventAt
            ? formatSyncUpdatedAt(workloadTelemetrySummary.lastEventAt, true)
            : "n/a"}
        </span>
      </div>
      <div
        class="mb-2 grid gap-1 rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground sm:grid-cols-4"
      >
        <span>watcher events: {watcherTelemetrySummary.sampleSize}</span>
        <span
          >active/fallback: {watcherTelemetrySummary.activeSessions}/{watcherTelemetrySummary.fallbackSessions}</span
        >
        <span
          >retry/relist/errors: {watcherTelemetrySummary.retryScheduledCount}/{watcherTelemetrySummary.relistCount}/{watcherTelemetrySummary.transportErrorCount}</span
        >
        <span>
          watcher last:
          {watcherTelemetrySummary.lastEventAt
            ? formatSyncUpdatedAt(watcherTelemetrySummary.lastEventAt, true)
            : "n/a"}
        </span>
      </div>
      <div
        class="mb-2 overflow-auto rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px]"
      >
        <div class="mb-1 font-semibold text-muted-foreground">Per-workload perf budget view</div>
        {#if workloadPerfRows.length === 0}
          <div class="text-muted-foreground">No workload telemetry yet</div>
        {:else}
          <table class="min-w-full text-left text-[11px]">
            <thead class="text-muted-foreground">
              <tr>
                <th class="pr-3">Workload</th>
                <th class="pr-3">Refresh p50/p95/p99</th>
                <th class="pr-3">Render p50/p95/p99</th>
                <th class="pr-3">Wait p50/p95/p99</th>
                <th class="pr-3">Cache</th>
              </tr>
            </thead>
            <tbody>
              {#each workloadPerfRows as row (row.workload)}
                <tr>
                  <td class="pr-3">{row.workload}</td>
                  <td class="pr-3">
                    {row.refreshP50 !== null
                      ? `${row.refreshP50}/${row.refreshP95}/${row.refreshP99}ms`
                      : "n/a"}
                  </td>
                  <td class="pr-3">
                    {row.renderP50 !== null
                      ? `${row.renderP50}/${row.renderP95}/${row.renderP99}ms`
                      : "n/a"}
                  </td>
                  <td class="pr-3">
                    {row.waitP50 !== null
                      ? `${row.waitP50}/${row.waitP95}/${row.waitP99}ms`
                      : "n/a"}
                  </td>
                  <td class="pr-3">{row.cacheHits}/{row.staleHits}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <div
        class="mb-2 overflow-auto rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px]"
      >
        <div class="mb-1 font-semibold text-muted-foreground">Watcher health view</div>
        {#if watcherTelemetryRows.length === 0}
          <div class="text-muted-foreground">No watcher telemetry yet</div>
        {:else}
          <table class="min-w-full text-left text-[11px]">
            <thead class="text-muted-foreground">
              <tr>
                <th class="pr-3">Cluster</th>
                <th class="pr-3">Sessions</th>
                <th class="pr-3">Fallback/Retry/Relist</th>
                <th class="pr-3">Errors</th>
                <th class="pr-3">Last kind</th>
                <th class="pr-3">Last event</th>
              </tr>
            </thead>
            <tbody>
              {#each watcherTelemetryRows as row (row.clusterId)}
                <tr>
                  <td class="pr-3">{row.clusterId}</td>
                  <td class="pr-3">{row.activeSessions}</td>
                  <td class="pr-3">{row.fallbackCount}/{row.retryCount}/{row.relistCount}</td>
                  <td class="pr-3">{row.transportErrorCount}/{row.logicErrorCount}</td>
                  <td class="pr-3">{row.lastKind ?? "n/a"}</td>
                  <td class="pr-3">
                    {row.lastEventAt ? formatSyncUpdatedAt(row.lastEventAt, true) : "n/a"}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <div
        class="max-h-36 overflow-auto rounded border border-border/70 bg-background/70 p-2 text-[11px]"
      >
        {#if debugLogs.length === 0}
          <div class="text-muted-foreground">No debug events yet</div>
        {:else}
          {#each debugLogs as log (log.at + log.message)}
            <div
              class={log.level === "error"
                ? "text-red-500"
                : log.level === "warn"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"}
            >
              [{new Date(log.at).toLocaleTimeString()}] {log.message}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  {/if}

  <main class="cluster-page__content">
    <div class={`grid ${workspaceGridClass} gap-3`}>
      <section class="min-w-0 rounded-lg border border-border p-3">
        {#if workspaceHydrated && effectiveWorkspaceLayout >= 2}
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-muted-foreground">
              {paneIndexLabel("pane-1")}
            </div>
            <select
              class="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={routeWorkloadType}
              onchange={(event) =>
                setPaneWorkload(
                  "pane-1",
                  (event.currentTarget as HTMLSelectElement).value as WorkloadType,
                )}
            >
              {#each getWorkloadOptionGroups() as group}
                <optgroup label={group.group}>
                  {#each group.options as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <label class="inline-flex items-center gap-1">
              <span>Cluster:</span>
              <select
                class="h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                value={cluster}
                disabled={$isClustersConfigLoading || clusterSwitchInFlight}
                onchange={(event) =>
                  void handleClusterSelectionChange(
                    (event.currentTarget as HTMLSelectElement).value,
                  )}
                aria-label="Select cluster"
              >
                {#each clusterSelectOptions as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
            <span>Workload: {routeWorkloadType || "overview"}</span>
            <span class={paneStatusClass("pane-1")}>Status: {paneStatusLabel("pane-1")}</span>
            <span class={syncBadgeTone(routeWorkloadType || "overview")}>
              Sync: {syncBadgeText(routeWorkloadType || "overview")}
            </span>
          </div>
        {/if}

        {#if workloadCacheBanner && hasEffectiveWorkloadData}
          <div
            class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          >
            {workloadCacheBanner}
          </div>
        {/if}

        {#if isLoading && !hasEffectiveWorkloadData}
          <div class="cluster-page__skeleton">
            <Skeleton class="h-4 w-full my-2" />
            <Skeleton class="h-4 w-full my-2" />
            <Skeleton class="h-4 w-full my-2" />
            <Skeleton class="h-4 w-full my-2" />
            <Skeleton class="h-4 w-full my-2" />
          </div>
        {:else if $errorMessage && !hasEffectiveWorkloadData}
          <Alert.Root variant="destructive" class="cluster-page__error">
            <Alert.Title>Error</Alert.Title>
            <Alert.Description>{$errorMessage}</Alert.Description>
          </Alert.Root>
        {:else if hasEffectiveWorkloadData}
          <WorkloadDisplay
            clusterId={cluster}
            pageData={{
              ...data,
              name: clusterName || data.name || cluster,
              namespace: resolvedWorkloadNamespace || "all",
              filtersKey: `${resolvedWorkloadNamespace || "all"}::${sortField || "name"}`,
            }}
            workloadData={effectiveWorkloadData}
          />
        {:else}
          <Alert.Root class="cluster-page__no-data">
            <Alert.Title>No data</Alert.Title>
            <Alert.Description>
              No {data.workload || "pods"} found in the selected namespace.
            </Alert.Description>
          </Alert.Root>
        {/if}
      </section>

      {#if workspaceHydrated && effectiveWorkspaceLayout >= 2}
        {@const pane = workspacePanes["pane-2"]}
        {@const paneHasData = paneHasEffectiveData("pane-2")}
        <section class="min-w-0 rounded-lg border border-border p-3">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-muted-foreground">
              {paneIndexLabel("pane-2")}
            </div>
            <select
              class="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={pane.workload}
              onchange={(event) =>
                setPaneWorkload(
                  "pane-2",
                  (event.currentTarget as HTMLSelectElement).value as WorkloadType,
                )}
            >
              {#each getWorkloadOptionGroups() as group}
                <optgroup label={group.group}>
                  {#each group.options as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <label class="inline-flex items-center gap-1">
              <span>Cluster:</span>
              <select
                class="h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                value={pane.clusterId || cluster}
                disabled={$isClustersConfigLoading}
                onchange={(event) =>
                  setPaneCluster("pane-2", (event.currentTarget as HTMLSelectElement).value)}
                aria-label="Select cluster"
              >
                {#each clusterSelectOptions as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
            <span>Workload: {pane.workload}</span>
            <span class={paneStatusClass("pane-2")}>Status: {paneStatusLabel("pane-2")}</span>
            <span class={syncBadgeTone(pane.workload, pane.clusterId || cluster)}>
              Sync: {syncBadgeText(pane.workload, pane.clusterId || cluster)}
            </span>
          </div>

          {#if paneLoading("pane-2") && !paneHasData}
            <div class="space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-full" />
            </div>
          {:else if paneError("pane-2") && !paneHasData}
            <Alert.Root variant="destructive">
              <Alert.Title>Error</Alert.Title>
              <Alert.Description>{paneError("pane-2")}</Alert.Description>
            </Alert.Root>
          {:else}
            <WorkloadDisplay
              clusterId={pane.clusterId || cluster}
              pageData={buildPanePageData(pane)}
              workloadData={paneWorkloadData("pane-2")}
            />
          {/if}
        </section>
      {/if}

      {#if workspaceHydrated && effectiveWorkspaceLayout >= 3}
        {@const pane = workspacePanes["pane-3"]}
        {@const paneHasData = paneHasEffectiveData("pane-3")}
        <section class="min-w-0 rounded-lg border border-border p-3">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="text-xs font-semibold text-muted-foreground">
              {paneIndexLabel("pane-3")}
            </div>
            <select
              class="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={pane.workload}
              onchange={(event) =>
                setPaneWorkload(
                  "pane-3",
                  (event.currentTarget as HTMLSelectElement).value as WorkloadType,
                )}
            >
              {#each getWorkloadOptionGroups() as group}
                <optgroup label={group.group}>
                  {#each group.options as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </optgroup>
              {/each}
            </select>
          </div>
          <div class="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <label class="inline-flex items-center gap-1">
              <span>Cluster:</span>
              <select
                class="h-6 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                value={pane.clusterId || cluster}
                disabled={$isClustersConfigLoading}
                onchange={(event) =>
                  setPaneCluster("pane-3", (event.currentTarget as HTMLSelectElement).value)}
                aria-label="Select cluster"
              >
                {#each clusterSelectOptions as option (option.value)}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
            <span>Workload: {pane.workload}</span>
            <span class={paneStatusClass("pane-3")}>Status: {paneStatusLabel("pane-3")}</span>
            <span class={syncBadgeTone(pane.workload, pane.clusterId || cluster)}>
              Sync: {syncBadgeText(pane.workload, pane.clusterId || cluster)}
            </span>
          </div>

          {#if paneLoading("pane-3") && !paneHasData}
            <div class="space-y-2">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-full" />
            </div>
          {:else if paneError("pane-3") && !paneHasData}
            <Alert.Root variant="destructive">
              <Alert.Title>Error</Alert.Title>
              <Alert.Description>{paneError("pane-3")}</Alert.Description>
            </Alert.Root>
          {:else}
            <WorkloadDisplay
              clusterId={pane.clusterId || cluster}
              pageData={buildPanePageData(pane)}
              workloadData={paneWorkloadData("pane-3")}
            />
          {/if}
        </section>
      {/if}
    </div>
  </main>
</div>
