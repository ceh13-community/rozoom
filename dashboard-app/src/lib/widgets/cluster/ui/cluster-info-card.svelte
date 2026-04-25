<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onDestroy, onMount } from "svelte";
  import {
    getLastHealthCheck,
    startGlobalWatcher,
    stopGlobalWatcher,
    updateClusterHealthChecks,
    clusterStates,
    clusterHealthChecks,
    selectClusterHealthCheck,
    loadClusterRefreshInterval,
    saveClusterRefreshInterval,
    loadClusterLinterEnabled,
    saveClusterLinterEnabled,
    isClusterHealthCheckHydrated,
    REFRESH_INTERVAL_OPTIONS,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    isValidRefreshInterval,
    type ClusterHealthChecks,
  } from "$features/check-health/";
  import { armorHubState } from "$features/armor-hub";
  import { complianceHubState } from "$features/compliance-hub";
  import { trivyHubState } from "$features/trivy-hub";
  import { alertHubState } from "$features/alerts-hub";
  import { metricsSourcesState } from "$features/metrics-sources";
  import { deprecationScanState } from "$features/deprecation-scan";
  import { versionAuditState } from "$features/version-audit";
  import { backupAuditState } from "$features/backup-audit";
  import type { ApiServerHealth as ApiServerHealthStatus } from "$features/check-health/model/types";
  import { getColorForClusterCard } from "$features/check-health";
  import { countTotalPodRestarts, sortedMetricsEndpoints } from "$features/check-health";
  import { globalLinterEnabled } from "$features/check-health/model/linter-preferences";
  import {
    buildPrimaryAlert,
    humanizeClusterError,
    isConnectionError,
  } from "$widgets/datalists/ui/model/overview-diagnostics";
  import MetricsStatus from "./metrics-status.svelte";
  import DeploymentsCount from "./deployments-count.svelte";
  import ReplicasetsCount from "./replicasets-count.svelte";
  import StatefulsetsCount from "./statefulsets-count.svelte";
  import DaemonsetsCount from "./daemonsets-count.svelte";
  import JobsCount from "./jobs-count.svelte";
  import CronjobsTotal from "./cronjobs-total.svelte";
  import PodsCount from "./pods-count.svelte";
  import NodesCount from "./nodes-count.svelte";
  import ApiServerHealth from "./api-server-health.svelte";
  import ApiServerLatency from "./api-server-latency.svelte";
  import CertificatesHealth from "./certificates-health.svelte";
  import PodIssues from "./pod-issues.svelte";
  import AdmissionWebhooks from "./admission-webhooks.svelte";
  import WarningEvents from "./warning-events.svelte";
  import BlackboxProbes from "./blackbox-probes.svelte";
  import ApfHealth from "./apf-health.svelte";
  import NamespacesList from "./namespaces-list.svelte";
  import PodrestartsCount from "./podrestarts-count.svelte";
  import CronjobsCount from "./cronjobs-count.svelte";
  import NodesStatus from "./nodes-status.svelte";
  import EtcdHealth from "./etcd-health.svelte";
  import DeprecationScanSummary from "./deprecation-scan-summary.svelte";
  import VersionAuditSummary from "./version-audit-summary.svelte";
  import BackupAuditSummary from "./backup-audit-summary.svelte";
  import ResourcesHygiene from "./resources-hygiene.svelte";
  import ClusterScore from "./cluster-score.svelte";
  import ClusterHealthScore from "./cluster-health-score.svelte";
  import HpaStatus from "./hpa-status.svelte";
  import ProbesHealth from "./probes-health.svelte";
  import PodQos from "./pod-qos.svelte";
  import VpaStatus from "./vpa-status.svelte";
  import TopologyHa from "./topology-ha.svelte";
  import PdbStatus from "./pdb-status.svelte";
  import PriorityStatus from "./priority-status.svelte";
  import PodSecurity from "./pod-security.svelte";
  import NetworkIsolation from "./network-isolation.svelte";
  import SecretsHygiene from "./secrets-hygiene.svelte";
  import SecurityHardening from "./security-hardening.svelte";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import {
    ChevronDown,
    Gauge,
    Refresh,
    ShieldQuestion,
    SquareChevronRight,
  } from "$shared/ui/icons";
  import { Button } from "$shared/ui/button";
  import { Checkbox } from "$shared/ui/checkbox";
  import type { AppClusterConfig } from "$entities/config/";
  import { getClusterPlatformLabel } from "$shared/ui/cluster-platform";
  import * as Popover from "$shared/ui/popover";
  import { markClusterRefreshHintSeen } from "$features/cluster-manager";
  import { stopAllBackgroundPollers } from "$shared/lib/background-pollers";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import { resolveClusterRuntimeBudgetForCluster } from "$shared/lib/cluster-runtime-manager";
  import {
    hasFreshDiagnosticsScope,
    hasLoadedDiagnosticsScope,
  } from "$features/check-health/model/diagnostics-scope-state";
  import ClusterRuntimeTuningPanel from "./cluster-runtime-tuning-panel.svelte";
  import DriftBadge from "./drift-badge.svelte";
  import ResourceQuotasStatus from "./resource-quotas-status.svelte";
  import LimitRangesStatus from "./limit-ranges-status.svelte";
  import StorageStatus from "./storage-status.svelte";
  import RbacOverviewStatus from "./rbac-overview-status.svelte";
  import IngressStatus from "./ingress-status.svelte";
  import ServiceMeshStatus from "./service-mesh-status.svelte";
  import ImageFreshnessStatus from "./image-freshness-status.svelte";
  import NodeUtilizationStatus from "./node-utilization-status.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    cluster: AppClusterConfig;
    autoRefreshActive?: boolean;
    syntheticMode?: boolean;
  }

  const { cluster, autoRefreshActive = true, syntheticMode = false }: Props = $props();

  const clusterUuid = cluster.uuid;
  const clusterCheck$ = selectClusterHealthCheck(clusterUuid);
  let lastCheck = $derived($globalLinterEnabled ? $clusterCheck$ || null : null);
  const scoredChecks = $derived.by<ClusterHealthChecks | null>(() => {
    if (!lastCheck || "errors" in lastCheck) return null;
    return lastCheck;
  });
  const platformLabel = $derived.by(() => getClusterPlatformLabel(cluster.name));
  const checkState = $derived($clusterStates[cluster.uuid] || { loading: false, error: null });
  const isClustersListRoute = $derived($page.url.pathname === "/dashboard");
  const nameSpaacesList = $derived(
    lastCheck && "namespaces" in lastCheck ? lastCheck.namespaces : [],
  );
  const podRestarts = $derived(
    lastCheck && "podRestarts" in lastCheck ? countTotalPodRestarts(lastCheck.podRestarts) : 0,
  );
  const deploymentsCount = $derived(
    lastCheck && "deployments" in lastCheck ? lastCheck.deployments : 0,
  );
  const replicaSetsCount = $derived(
    lastCheck && "replicaSets" in lastCheck ? lastCheck.replicaSets : 0,
  );
  const cronJobCount = $derived(lastCheck && "cronJobs" in lastCheck ? lastCheck.cronJobs : 0);
  const cronJobsHealth = $derived(
    lastCheck && "cronJobsHealth" in lastCheck ? lastCheck.cronJobsHealth : null,
  );
  const daemonSetsCount = $derived(
    lastCheck && "daemonSets" in lastCheck ? lastCheck.daemonSets : 0,
  );
  const statefulSetsCount = $derived(
    lastCheck && "statefulSets" in lastCheck ? lastCheck.statefulSets : 0,
  );
  const jobsCount = $derived(lastCheck && "jobs" in lastCheck ? lastCheck.jobs : 0);
  const podsCount = $derived(lastCheck && "pods" in lastCheck ? lastCheck.pods : 0);
  const nodesSummary = $derived(
    lastCheck && "nodes" in lastCheck ? (lastCheck.nodes?.summary ?? null) : null,
  );
  const nodesReadyCount = $derived(nodesSummary?.count.ready ?? 0);
  const nodesTotalCount = $derived(nodesSummary?.count.total ?? 0);
  const apiServerHealth = $derived.by<ApiServerHealthStatus | null>(() => {
    if (!lastCheck || !("apiServerHealth" in lastCheck)) return null;

    return lastCheck.apiServerHealth ?? null;
  });
  const apiServerLatency = $derived.by(() => {
    if (!lastCheck || !("apiServerLatency" in lastCheck)) return null;
    return lastCheck.apiServerLatency ?? null;
  });
  const certificatesHealth = $derived.by(() => {
    if (!lastCheck || !("certificatesHealth" in lastCheck)) return null;
    return lastCheck.certificatesHealth ?? null;
  });
  const podIssues = $derived.by(() => {
    if (!lastCheck || !("podIssues" in lastCheck)) return null;
    return lastCheck.podIssues ?? null;
  });
  const admissionWebhooks = $derived.by(() => {
    if (!lastCheck || !("admissionWebhooks" in lastCheck)) return null;
    return lastCheck.admissionWebhooks ?? null;
  });
  const warningEvents = $derived.by(() => {
    if (!lastCheck || !("warningEvents" in lastCheck)) return null;
    return lastCheck.warningEvents ?? null;
  });
  const blackboxProbes = $derived.by(() => {
    if (!lastCheck || !("blackboxProbes" in lastCheck)) return null;
    return lastCheck.blackboxProbes ?? null;
  });
  const apfHealth = $derived.by(() => {
    if (!lastCheck || !("apfHealth" in lastCheck)) return null;
    return lastCheck.apfHealth ?? null;
  });
  const etcdHealth = $derived.by(() => {
    if (!lastCheck || !("etcdHealth" in lastCheck)) return null;
    return lastCheck.etcdHealth ?? null;
  });
  const resourcesHygiene = $derived.by(() => {
    if (!lastCheck || !("resourcesHygiene" in lastCheck)) return null;
    return lastCheck.resourcesHygiene ?? null;
  });
  const hpaStatus = $derived.by(() => {
    if (!lastCheck || !("hpaStatus" in lastCheck)) return null;
    return lastCheck.hpaStatus ?? null;
  });
  const probesHealth = $derived.by(() => {
    if (!lastCheck || !("probesHealth" in lastCheck)) return null;
    return lastCheck.probesHealth ?? null;
  });
  const podQos = $derived.by(() => {
    if (!lastCheck || !("podQos" in lastCheck)) return null;
    return lastCheck.podQos ?? null;
  });
  const vpaStatus = $derived.by(() => {
    if (!lastCheck || !("vpaStatus" in lastCheck)) return null;
    return lastCheck.vpaStatus ?? null;
  });
  const topologyHa = $derived.by(() => {
    if (!lastCheck || !("topologyHa" in lastCheck)) return null;
    return lastCheck.topologyHa ?? null;
  });
  const pdbStatus = $derived.by(() => {
    if (!lastCheck || !("pdbStatus" in lastCheck)) return null;
    return lastCheck.pdbStatus ?? null;
  });
  const priorityStatus = $derived.by(() => {
    if (!lastCheck || !("priorityStatus" in lastCheck)) return null;
    return lastCheck.priorityStatus ?? null;
  });
  const podSecurity = $derived.by(() => {
    if (!lastCheck || !("podSecurity" in lastCheck)) return null;
    return lastCheck.podSecurity ?? null;
  });
  const networkIsolation = $derived.by(() => {
    if (!lastCheck || !("networkIsolation" in lastCheck)) return null;
    return lastCheck.networkIsolation ?? null;
  });
  const secretsHygiene = $derived.by(() => {
    if (!lastCheck || !("secretsHygiene" in lastCheck)) return null;
    return lastCheck.secretsHygiene ?? null;
  });
  const securityHardening = $derived.by(() => {
    if (!lastCheck || !("securityHardening" in lastCheck)) return null;
    return lastCheck.securityHardening ?? null;
  });
  const resourceQuotas = $derived.by(() => {
    if (!lastCheck || !("resourceQuotas" in lastCheck)) return null;
    return lastCheck.resourceQuotas ?? null;
  });
  const limitRanges = $derived.by(() => {
    if (!lastCheck || !("limitRanges" in lastCheck)) return null;
    return lastCheck.limitRanges ?? null;
  });
  const storageStatus = $derived.by(() => {
    if (!lastCheck || !("storageStatus" in lastCheck)) return null;
    return lastCheck.storageStatus ?? null;
  });
  const rbacOverview = $derived.by(() => {
    if (!lastCheck || !("rbacOverview" in lastCheck)) return null;
    return lastCheck.rbacOverview ?? null;
  });
  const ingressStatus = $derived.by(() => {
    if (!lastCheck || !("ingressStatus" in lastCheck)) return null;
    return lastCheck.ingressStatus ?? null;
  });
  const serviceMesh = $derived.by(() => {
    if (!lastCheck || !("serviceMesh" in lastCheck)) return null;
    return lastCheck.serviceMesh ?? null;
  });
  const imageFreshness = $derived.by(() => {
    if (!lastCheck || !("imageFreshness" in lastCheck)) return null;
    return lastCheck.imageFreshness ?? null;
  });
  const nodeUtilization = $derived.by(() => {
    if (!lastCheck || !("nodeUtilization" in lastCheck)) return null;
    return lastCheck.nodeUtilization ?? null;
  });
  const clusterCardColor = $derived(getColorForClusterCard(lastCheck));
  const awaitingInitialRefresh = $derived(Boolean(cluster.needsInitialRefreshHint) && !lastCheck);
  const displayClusterCardColor = $derived.by(() => {
    if (!effectiveLinter)
      return {
        color: "bg-slate-600",
        text: "Paused",
        tooltip: "Health monitoring is paused. Enable the linter toggle to start diagnostics.",
      };
    if (awaitingInitialRefresh)
      return {
        color: "bg-slate-500",
        text: "Pending",
        tooltip: "Waiting for initial health check. Click the refresh button to start.",
      };
    if (checkState.error && isConnectionError(checkState.error))
      return {
        color: "bg-slate-600",
        text: "Offline",
        tooltip: "Cannot connect to the cluster API server. Check if the cluster is running.",
      };
    const base = clusterCardColor;
    const tooltip =
      base.text === "Ok"
        ? "All health checks passed. Cluster is healthy."
        : base.text === "Warning"
          ? "Some health checks have warnings. Review the diagnostics for details."
          : base.text === "Critical"
            ? "Critical issues detected. Immediate attention recommended."
            : "Cluster status could not be determined. Run a health check to update.";
    return { ...base, tooltip };
  });
  const primaryAlert = $derived.by(() => {
    if (awaitingInitialRefresh) {
      return {
        severity: "info" as const,
        title: "Initial refresh required",
        detail:
          "Use refresh once to load the first cluster state. Scheduled updates start after that.",
      };
    }
    return buildPrimaryAlert(lastCheck);
  });
  const globalLinter = $derived($globalLinterEnabled);
  const deprecationSummary = $derived(
    globalLinter ? ($deprecationScanState[cluster.uuid]?.summary ?? null) : null,
  );
  const versionSummary = $derived(
    globalLinter ? ($versionAuditState[cluster.uuid]?.summary ?? null) : null,
  );
  const backupSummary = $derived(
    globalLinter ? ($backupAuditState[cluster.uuid]?.summary ?? null) : null,
  );
  const armorSummary = $derived.by(() => {
    const state = $armorHubState[cluster.uuid]?.summary ?? null;
    if (state) return state;
    if (lastCheck && !("errors" in lastCheck) && lastCheck.armorSummary) {
      return lastCheck.armorSummary;
    }
    return null;
  });
  const complianceState = $derived(
    globalLinter ? ($complianceHubState[cluster.uuid] ?? null) : null,
  );
  const trivySummary = $derived.by(() => {
    const state = $trivyHubState[cluster.uuid]?.summary ?? null;
    if (state) return state;
    if (lastCheck && !("errors" in lastCheck) && lastCheck.trivySummary) {
      return lastCheck.trivySummary;
    }
    return null;
  });
  const alertsState = $derived(globalLinter ? ($alertHubState[cluster.uuid] ?? null) : null);
  const metricsState = $derived(globalLinter ? ($metricsSourcesState[cluster.uuid] ?? null) : null);
  function parseSummaryTimestamp(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isPersistedSummaryNewer(
    liveLastRunAt: string | null | undefined,
    snapshotLastRunAt: string | null | undefined,
  ): boolean {
    return parseSummaryTimestamp(snapshotLastRunAt) > parseSummaryTimestamp(liveLastRunAt);
  }
  function parseMetricsEndpointStatus(status: unknown): "available" | "unreachable" | "not_found" {
    if (typeof status === "string") {
      if (status.includes("Available")) return "available";
      if (
        status.includes("Not found") ||
        status.includes("not found") ||
        status.includes("not_found")
      )
        return "not_found";
      return "unreachable";
    }
    if (Array.isArray(status)) {
      const hasAvailable = status.some((entry) => {
        if (typeof entry === "string") return entry.includes("Available");
        if (entry && typeof entry === "object" && "result" in entry)
          return (entry as { result?: unknown }).result === 1;
        return false;
      });
      if (hasAvailable) return "available";
      const hasNotFound = status.some((entry) => {
        if (entry && typeof entry === "object" && "result" in entry)
          return (entry as { result?: unknown }).result === -1;
        return false;
      });
      if (hasNotFound) return "not_found";
      return "unreachable";
    }
    return "not_found";
  }
  const metricsEndpoints = $derived.by(() => {
    const persistedMetricsSummary =
      lastCheck && !("errors" in lastCheck) ? (lastCheck.metricsSourcesSummary ?? null) : null;
    const preferPersistedMetricsSummary =
      persistedMetricsSummary &&
      isPersistedSummaryNewer(metricsState?.summary.lastRunAt, persistedMetricsSummary.lastRunAt);

    if (metricsState?.checks?.length && !preferPersistedMetricsSummary) {
      return metricsState.checks.map((check) => ({
        status: check.status,
      }));
    }

    if (!lastCheck || "errors" in lastCheck) return [];
    return Object.values(lastCheck.metricsChecks?.endpoints ?? {}).map((endpoint) => ({
      status: parseMetricsEndpointStatus(endpoint?.status),
    }));
  });
  const complianceProblemCount = $derived.by(() => {
    if (complianceState) {
      return complianceState.findings.filter(
        (finding) => finding.severity !== "info" && finding.provider === "kubescape",
      ).length;
    }
    if (lastCheck && !("errors" in lastCheck) && lastCheck.complianceSummary) {
      return lastCheck.complianceSummary.findingCount;
    }
    return 0;
  });
  const complianceSummaryStatus = $derived.by(() => {
    if (complianceState?.summary.status) return complianceState.summary.status;
    if (lastCheck && !("errors" in lastCheck) && lastCheck.complianceSummary) {
      return lastCheck.complianceSummary.status;
    }
    return "unavailable";
  });
  const activeAlertsCount = $derived.by(() => {
    const persistedAlertsSummary =
      lastCheck && !("errors" in lastCheck) ? (lastCheck.alertsSummary ?? null) : null;
    const preferPersistedAlertsSummary =
      persistedAlertsSummary &&
      isPersistedSummaryNewer(alertsState?.summary.lastRunAt, persistedAlertsSummary.lastRunAt);

    if (alertsState && !preferPersistedAlertsSummary) {
      return alertsState.alerts.filter(
        (alert) => alert.state === "firing" || alert.state === "pending",
      ).length;
    }
    if (persistedAlertsSummary) {
      return persistedAlertsSummary.activeCount;
    }
    return lastCheck && !("errors" in lastCheck) ? (lastCheck.warningEvents?.items.length ?? 0) : 0;
  });
  const metricsAvailableCount = $derived.by(() => {
    const persistedMetricsSummary =
      lastCheck && !("errors" in lastCheck) ? (lastCheck.metricsSourcesSummary ?? null) : null;
    const preferPersistedMetricsSummary =
      persistedMetricsSummary &&
      isPersistedSummaryNewer(metricsState?.summary.lastRunAt, persistedMetricsSummary.lastRunAt);

    if (metricsState?.checks?.length && !preferPersistedMetricsSummary) {
      return metricsEndpoints.filter((endpoint) => endpoint.status === "available").length;
    }
    if (persistedMetricsSummary) {
      return persistedMetricsSummary.availableCount;
    }
    return metricsEndpoints.filter((endpoint) => endpoint.status === "available").length;
  });
  const metricsTotalCount = $derived.by(() => {
    const persistedMetricsSummary =
      lastCheck && !("errors" in lastCheck) ? (lastCheck.metricsSourcesSummary ?? null) : null;
    const preferPersistedMetricsSummary =
      persistedMetricsSummary &&
      isPersistedSummaryNewer(metricsState?.summary.lastRunAt, persistedMetricsSummary.lastRunAt);

    if (metricsState?.checks?.length && !preferPersistedMetricsSummary) {
      return metricsEndpoints.length;
    }
    if (persistedMetricsSummary) {
      return persistedMetricsSummary.totalCount;
    }
    return metricsEndpoints.length;
  });

  let sortedMetrics = $derived.by(() => {
    if (!lastCheck) return [];

    return sortedMetricsEndpoints((lastCheck as ClusterHealthChecks).metricsChecks.endpoints);
  });

  const CARD_DIAGNOSTICS_TTL_MS = 5 * 60_000;
  type CardDiagnosticsScope = "config" | "health" | "infrastructure";
  let refreshInterval = $state(String(DEFAULT_REFRESH_INTERVAL_MINUTES));
  let linterEnabled = $state(true);
  let manualRefreshPending = $state(false);
  let healthCheckHydrated = $state(false);
  let refreshUiLoading = $state(false);
  let activeCardDiagnosticsScope = $state<CardDiagnosticsScope | null>(null);
  let queuedCardDiagnosticsScopes = $state<CardDiagnosticsScope[]>([]);
  const refreshIntervalMs = $derived.by(() => Number(refreshInterval) * 60_000);
  const isRefreshLoading = $derived(checkState.loading || refreshUiLoading);
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));
  const effectiveLinter = $derived(globalLinter && linterEnabled);
  const effectiveDiagnosticsEnabled = $derived(autoDiagnosticsEnabled && effectiveLinter);
  const effectiveRuntimeBudget = $derived(resolveClusterRuntimeBudgetForCluster(cluster.uuid));
  const hasConfigDiagnosticsSnapshot = $derived.by(() =>
    lastCheck && !("errors" in lastCheck) ? hasLoadedDiagnosticsScope(lastCheck, "config") : false,
  );
  const hasHealthDiagnosticsSnapshot = $derived.by(() =>
    lastCheck && !("errors" in lastCheck) ? hasLoadedDiagnosticsScope(lastCheck, "health") : false,
  );
  const hasFreshConfigDiagnosticsSnapshot = $derived.by(
    () =>
      hasConfigDiagnosticsSnapshot &&
      !!lastCheck &&
      !("errors" in lastCheck) &&
      hasFreshDiagnosticsScope(lastCheck, "config", CARD_DIAGNOSTICS_TTL_MS),
  );
  const hasFreshHealthDiagnosticsSnapshot = $derived.by(
    () =>
      hasHealthDiagnosticsSnapshot &&
      !!lastCheck &&
      !("errors" in lastCheck) &&
      hasFreshDiagnosticsScope(lastCheck, "health", CARD_DIAGNOSTICS_TTL_MS),
  );
  const canShowConfigDiagnostics = $derived(
    hasConfigDiagnosticsSnapshot || hasFreshConfigDiagnosticsSnapshot,
  );
  const canShowHealthDiagnostics = $derived(
    hasHealthDiagnosticsSnapshot || hasFreshHealthDiagnosticsSnapshot,
  );
  const hasInfrastructureSnapshot = $derived.by(() => {
    if (!lastCheck || "errors" in lastCheck) return false;
    const lc = lastCheck as Record<string, unknown>;
    return Boolean(lc.ingressStatus || lc.storageStatus || lc.resourceQuotas || lc.rbacOverview);
  });
  let infrastructureAutoQueued = false;
  let configAutoQueued = false;
  let healthAutoQueued = false;
  const showInitialRefreshHint = $derived(
    Boolean(cluster.needsInitialRefreshHint) && !isRefreshLoading && isClustersListRoute,
  );
  const showInitialRefreshButton = $derived(Boolean(cluster.needsInitialRefreshHint));
  const shouldStartWatcherImmediately = $derived.by(
    () =>
      !cluster.needsInitialRefreshHint &&
      (!lastCheck || ("errors" in lastCheck && Boolean(lastCheck.errors))),
  );

  function goToCluster() {
    if (cluster.name) {
      stopAllBackgroundPollers();
      goto(`/dashboard/clusters/${encodeURIComponent(cluster.uuid)}?workload=overview`);
    }
  }

  function goToWorkloads(workload: string, sortField?: string) {
    if (!cluster.name) return;

    let path = `/dashboard/clusters/${encodeURIComponent(cluster.uuid)}?workload=${workload}`;
    if (sortField) {
      path += `&sort_field=${sortField}`;
    }
    goto(path);
  }

  function handlePodsClick() {
    goToWorkloads("podsrestarts", podRestarts > 0 ? "restarts" : "name");
  }

  function handleNodesClick() {
    goToWorkloads("nodespressures", "name");
  }

  function handleKeypress(event: KeyboardEvent, handler: () => void) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  }

  function toggleLinter() {
    linterEnabled = !linterEnabled;
    void saveClusterLinterEnabled(cluster.uuid, linterEnabled);
  }

  function updateRefreshInterval(value: string) {
    refreshInterval = value;
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return;
    if (!cluster.uuid) return;
    void saveClusterRefreshInterval(cluster.uuid, minutes);
  }

  async function refreshData() {
    if (isRefreshLoading) {
      manualRefreshPending = true;
      return;
    }
    refreshUiLoading = true;
    try {
      const completingInitialRefresh = cluster.needsInitialRefreshHint;
      manualRefreshPending = false;
      await updateClusterHealthChecks(cluster.uuid, { force: true });
      if (cluster.status === "error") {
        cluster.status = "ok";
      }
      if (completingInitialRefresh) {
        cluster.needsInitialRefreshHint = false;
        void markClusterRefreshHintSeen(cluster.uuid);
      }
    } finally {
      refreshUiLoading = false;
    }
  }

  function isDiagnosticsScopeQueued(scope: CardDiagnosticsScope): boolean {
    return queuedCardDiagnosticsScopes.includes(scope);
  }

  function enqueueCardDiagnostics(scope: CardDiagnosticsScope) {
    const alreadyActive = activeCardDiagnosticsScope === scope;
    const alreadyQueued = isDiagnosticsScopeQueued(scope);
    if (alreadyActive || alreadyQueued) return;
    queuedCardDiagnosticsScopes = [...queuedCardDiagnosticsScopes, scope];
  }

  function requestCardDiagnostics(scope: CardDiagnosticsScope) {
    if (scope === "config" && canShowConfigDiagnostics) return;
    if (scope === "health" && canShowHealthDiagnostics) return;
    if (scope === "infrastructure" && hasInfrastructureSnapshot) return;
    enqueueCardDiagnostics(scope);
  }

  async function bootstrapCardDiagnostics(scope: CardDiagnosticsScope) {
    if (scope === "infrastructure") {
      await bootstrapInfrastructureChecks();
      return;
    }
    await updateClusterHealthChecks(cluster.uuid, {
      force: true,
      diagnostics: true,
      diagnosticsScope: scope,
    });
  }

  async function bootstrapInfrastructureChecks() {
    const { checkIngressStatus } = await import("$features/check-health/api/check-ingress-status");
    const { checkStorageStatus } = await import("$features/check-health/api/check-storage-status");
    const { checkResourceQuotas } = await import(
      "$features/check-health/api/check-resource-quotas"
    );
    const { checkLimitRanges } = await import("$features/check-health/api/check-limit-ranges");
    const { checkRbacOverview } = await import("$features/check-health/api/check-rbac-overview");
    const { checkServiceMesh } = await import("$features/check-health/api/check-service-mesh");
    const { checkNodeUtilization } = await import(
      "$features/check-health/api/check-node-utilization"
    );

    const [ingress, storage, quotas, limits, rbac, mesh, nodeUtil] = await Promise.all([
      checkIngressStatus(cluster.uuid).catch(() => null),
      checkStorageStatus(cluster.uuid).catch(() => null),
      checkResourceQuotas(cluster.uuid).catch(() => null),
      checkLimitRanges(cluster.uuid).catch(() => null),
      checkRbacOverview(cluster.uuid).catch(() => null),
      checkServiceMesh(cluster.uuid).catch(() => null),
      checkNodeUtilization(cluster.uuid).catch(() => null),
    ]);

    // Merge infrastructure results directly into the in-memory store
    // instead of updateClusterCheckPartially which rebuilds a full check
    // from cache and wipes existing diagnostics/workload data
    clusterHealthChecks.update((checks) => {
      const existing = checks[cluster.uuid];
      if (!existing || "errors" in existing) return checks;
      const merged = { ...existing };
      if (ingress) (merged as Record<string, unknown>).ingressStatus = ingress;
      if (storage) (merged as Record<string, unknown>).storageStatus = storage;
      if (quotas) (merged as Record<string, unknown>).resourceQuotas = quotas;
      if (limits) (merged as Record<string, unknown>).limitRanges = limits;
      if (rbac) (merged as Record<string, unknown>).rbacOverview = rbac;
      if (mesh) (merged as Record<string, unknown>).serviceMesh = mesh;
      if (nodeUtil) (merged as Record<string, unknown>).nodeUtilization = nodeUtil;
      return { ...checks, [cluster.uuid]: merged };
    });
  }

  $effect(() => {
    if (!manualRefreshPending) return;
    if (isRefreshLoading) return;
    manualRefreshPending = false;
    void refreshData();
  });

  // Auto-queue infrastructure after first successful refresh
  $effect(() => {
    if (infrastructureAutoQueued) return;
    if (!lastCheck || "errors" in lastCheck) return;
    if (hasInfrastructureSnapshot) return;
    infrastructureAutoQueued = true;
    enqueueCardDiagnostics("infrastructure");
  });

  // Auto-queue config/health diagnostics when auto-diagnostics is enabled
  // (catches the case where compact view started them but view switch cancelled)
  $effect(() => {
    if (configAutoQueued) return;
    if (!effectiveDiagnosticsEnabled) return;
    if (!lastCheck || "errors" in lastCheck) return;
    if (canShowConfigDiagnostics) return;
    configAutoQueued = true;
    enqueueCardDiagnostics("config");
  });

  $effect(() => {
    if (healthAutoQueued) return;
    if (!effectiveDiagnosticsEnabled) return;
    if (!lastCheck || "errors" in lastCheck) return;
    if (canShowHealthDiagnostics) return;
    healthAutoQueued = true;
    enqueueCardDiagnostics("health");
  });

  $effect(() => {
    if (!cluster.uuid) return;
    if (refreshUiLoading) return;
    if (activeCardDiagnosticsScope) return;
    if (isRefreshLoading) return;
    if (queuedCardDiagnosticsScopes.length === 0) return;

    const [nextScope, ...rest] = queuedCardDiagnosticsScopes;
    queuedCardDiagnosticsScopes = rest;
    activeCardDiagnosticsScope = nextScope;

    void bootstrapCardDiagnostics(nextScope).finally(() => {
      activeCardDiagnosticsScope = null;
    });
  });

  onMount(async () => {
    try {
      if (!isClusterHealthCheckHydrated(cluster.uuid)) {
        await getLastHealthCheck(cluster.uuid);
      }
      const storedInterval = await loadClusterRefreshInterval(cluster.uuid);
      if (isValidRefreshInterval(storedInterval)) {
        refreshInterval = `${storedInterval}`;
      }
      linterEnabled = await loadClusterLinterEnabled(cluster.uuid);
    } catch (error) {
      // Don't set cluster.status = "error" - it mutates the prop and never resets.
      // The card will show the error state via checkState.error from the watcher instead.
    } finally {
      healthCheckHydrated = true;
    }
  });

  $effect(() => {
    if (!cluster.uuid) return;
    if (!healthCheckHydrated) return;
    if (!isClustersListRoute) {
      stopGlobalWatcher(cluster.uuid);
      return;
    }
    if (cluster.needsInitialRefreshHint) {
      stopGlobalWatcher(cluster.uuid);
      return;
    }
    if (!autoRefreshActive || !autoDiagnosticsEnabled) {
      stopGlobalWatcher(cluster.uuid);
      return;
    }
    startGlobalWatcher(cluster.uuid, refreshIntervalMs, shouldStartWatcherImmediately);
  });

  onDestroy(() => {
    stopGlobalWatcher(cluster.uuid);
  });
</script>

{#if cluster.name}
  <Card.Root
    data-testid="cluster-card"
    class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-700 shadow-md"
  >
    <Card.Title
      class="flex items-center text-white p-4 cursor-pointer {displayClusterCardColor?.color} rounded-xl mb-3 transition-colors duration-500"
    >
      <div class="relative flex">
        <Button
          class={`hover:bg-transparent transition ${
            showInitialRefreshHint
              ? "animate-pulse rounded-full ring-2 ring-white/80 ring-offset-2 ring-offset-transparent"
              : ""
          } ${isRefreshLoading ? "cursor-not-allowed opacity-70" : ""}`}
          variant="ghost"
          onclick={refreshData}
          disabled={isRefreshLoading}
        >
          <Refresh
            class={isRefreshLoading
              ? "animate-spin"
              : showInitialRefreshHint
                ? "animate-bounce"
                : ""}
          />
        </Button>
        {#if cluster.needsInitialRefreshHint}
          {#if showInitialRefreshHint}
            <span
              class="pointer-events-none absolute -right-16 top-1/2 -translate-y-1/2 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 shadow-sm"
            >
              refresh me
            </span>
          {/if}
        {/if}
      </div>

      <span
        role="button"
        class="truncate"
        title={cluster.name}
        onclick={goToCluster}
        onkeydown={(e) => handleKeypress(e, goToCluster)}
        tabindex="0">{cluster.name}</span
      >
      {#if cluster.status !== "error" && !isRefreshLoading && !lastCheck?.errors}
        <Button class="hover:bg-transparent ml-auto" variant="ghost" onclick={goToCluster}>
          <SquareChevronRight class="w-4 h-4" />
        </Button>
      {/if}
    </Card.Title>
    <div class="px-6 flex justify-between items-center gap-2 mb-2">
      General status:
      <div class="flex items-center gap-1.5">
        <DriftBadge clusterId={cluster.uuid} />
        <span title={displayClusterCardColor?.tooltip ?? ""} class="cursor-help">
          <Badge
            class="text-white {displayClusterCardColor?.color} max-w-20 h-7 transition-colors duration-500"
          >
            {displayClusterCardColor?.text.toUpperCase()}
          </Badge>
        </span>
      </div>
    </div>
    <div class="px-6 flex justify-between items-center gap-2 mb-2">
      Platform:
      <Badge class="text-white bg-slate-500 max-w-24 h-7">{platformLabel}</Badge>
    </div>
    <button
      type="button"
      class="mx-6 mb-3 block w-[calc(100%-3rem)] rounded-xl border border-slate-300/90 bg-white px-3.5 py-3.5 text-left text-sm text-slate-900 shadow-sm transition hover:bg-slate-50"
      onclick={goToCluster}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="text-[13px] font-semibold tracking-[0.01em] text-slate-950">Primary Alert</div>
        <Badge
          class={`min-w-16 justify-center text-white shadow-sm ${
            primaryAlert.severity === "critical"
              ? "bg-rose-600"
              : primaryAlert.severity === "warning"
                ? "bg-amber-600"
                : primaryAlert.severity === "ok"
                  ? "bg-emerald-600"
                  : "bg-sky-700"
          }`}
        >
          {primaryAlert.severity === "critical"
            ? "Critical"
            : primaryAlert.severity === "warning"
              ? "Warn"
              : primaryAlert.severity === "ok"
                ? "OK"
                : "Info"}
        </Badge>
      </div>
      <div class="mt-2 text-sm font-semibold leading-5 text-slate-950">{primaryAlert.title}</div>
      <div class="mt-1.5 text-xs font-medium leading-5 text-slate-700">{primaryAlert.detail}</div>
    </button>
    <div class="px-6 flex justify-between items-center gap-2 mb-3">
      Refresh:
      <div class="flex items-center gap-2">
        <label class="sr-only" for={`cluster-refresh-${cluster.uuid}`}>Refresh interval</label>
        <div class="relative inline-flex">
          <select
            id={`cluster-refresh-${cluster.uuid}`}
            class="h-8 min-w-[5.25rem] appearance-none cursor-pointer rounded-md border border-slate-500 bg-slate-700 pl-2.5 pr-7 text-xs font-semibold text-white shadow-sm outline-none transition hover:border-slate-300 focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
            bind:value={refreshInterval}
            onchange={(event) =>
              updateRefreshInterval((event.currentTarget as HTMLSelectElement).value)}
          >
            {#each REFRESH_INTERVAL_OPTIONS as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          <span
            class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/70"
            aria-hidden="true">▾</span
          >
        </div>
        {#if !syntheticMode}
          <Popover.Root>
            <Popover.Trigger>
              <Button variant="outline" size="sm" class="h-8 px-2.5 text-xs">Runtime</Button>
            </Popover.Trigger>
            <Popover.Content class="w-[392px]" sideOffset={8}>
              <ClusterRuntimeTuningPanel clusterId={cluster.uuid} />
            </Popover.Content>
          </Popover.Root>
        {/if}
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 {effectiveLinter
            ? 'border-emerald-500/60 text-emerald-400 hover:border-emerald-400 hover:text-emerald-300'
            : 'border-slate-500/60 text-slate-400 hover:border-slate-400 hover:text-slate-300'}"
          onclick={toggleLinter}
          disabled={!globalLinter}
          aria-pressed={effectiveLinter}
          aria-label="Toggle linter"
          title={!globalLinter
            ? "Linter disabled globally"
            : linterEnabled
              ? "Linter enabled - click to disable"
              : "Linter disabled - click to enable"}
        >
          <Gauge class="w-4 h-4" />
        </button>
      </div>
      {#if effectiveLinter && (displayClusterCardColor?.text === "Unknown" || displayClusterCardColor?.text === "Offline" || (cluster.status === "error" && cluster.errors?.length) || (checkState.error && checkState.error.length))}
        {@const rawError = cluster.errors ?? checkState.error ?? ""}
        {@const friendly = humanizeClusterError(rawError)}
        <Popover.Root>
          <Popover.Trigger>
            <ShieldQuestion class="w-4 h-4 cursor-pointer text-rose-400" />
          </Popover.Trigger>
          <Popover.Content class="w-80">
            <p class="text-rose-500 text-sm font-medium">{friendly.title}</p>
            <p class="text-xs text-slate-300 mt-1">{friendly.detail}</p>
          </Popover.Content>
        </Popover.Root>
      {/if}
    </div>
    {#if !cluster.needsInitialRefreshHint && !syntheticMode}
      <div
        class="px-6 flex justify-between items-center gap-2 mb-2 cursor-pointer"
        onclick={(e) => goToWorkloads("deprecationscan")}
        onkeydown={(e) => handleKeypress(e, () => goToWorkloads("deprecationscan"))}
        role="button"
        tabindex="0"
      >
        <DeprecationScanSummary clusterId={cluster.uuid} offline={cluster.offline} lazyLoad />
      </div>
      <div
        class="px-6 flex justify-between items-center gap-2 mb-2 cursor-pointer"
        onclick={(e) => goToWorkloads("versionaudit")}
        onkeydown={(e) => handleKeypress(e, () => goToWorkloads("versionaudit"))}
        role="button"
        tabindex="0"
      >
        <VersionAuditSummary clusterId={cluster.uuid} offline={cluster.offline} lazyLoad />
      </div>
      <div
        class="px-6 flex justify-between items-center gap-2 mb-3 cursor-pointer"
        onclick={(e) => goToWorkloads("backupaudit")}
        onkeydown={(e) => handleKeypress(e, () => goToWorkloads("backupaudit"))}
        role="button"
        tabindex="0"
      >
        <BackupAuditSummary clusterId={cluster.uuid} offline={cluster.offline} lazyLoad />
      </div>
    {:else}
      <div
        class="px-6 mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-700 shadow-sm"
      >
        {#if syntheticMode}
          Synthetic mode keeps top summaries minimized so fleet stress runs stay focused on card
          throughput.
        {:else}
          Summary widgets will activate after the first manual refresh.
        {/if}
      </div>
    {/if}
    {#if lastCheck}
      <details class="group px-6 mb-3">
        <summary class="flex items-center justify-between cursor-pointer py-1">
          <span>Workloads</span>
          <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
        </summary>

        {#if !lastCheck && isRefreshLoading}
          {#each { length: 4 } as _}
            <div class="h-4 w-full animate-pulse rounded-full bg-gray-300 mb-2"></div>
          {/each}
        {:else if lastCheck}
          <div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("deployments")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("deployments"))}
              role="button"
              tabindex="0"
            >
              <DeploymentsCount deployments={deploymentsCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("replicasets")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("replicasets"))}
              role="button"
              tabindex="0"
            >
              <ReplicasetsCount replicaSets={replicaSetsCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("statefulsets")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("statefulsets"))}
              role="button"
              tabindex="0"
            >
              <StatefulsetsCount statefulSets={statefulSetsCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("daemonsets")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("daemonsets"))}
              role="button"
              tabindex="0"
            >
              <DaemonsetsCount daemonSets={daemonSetsCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("jobs")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("jobs"))}
              role="button"
              tabindex="0"
            >
              <JobsCount jobs={jobsCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("jobs")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("jobs"))}
              role="button"
              tabindex="0"
            >
              <CronjobsTotal cronJobs={cronJobCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("pods")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("pods"))}
              role="button"
              tabindex="0"
            >
              <PodsCount pods={podsCount} />
            </div>
            <div
              class="cursor-pointer"
              onclick={(e) => goToWorkloads("nodesstatus")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("nodesstatus"))}
              role="button"
              tabindex="0"
            >
              <NodesCount ready={nodesReadyCount} total={nodesTotalCount} />
            </div>
          </div>
        {/if}
      </details>
      <NamespacesList namespaces={nameSpaacesList} />
    {/if}
    <details class="group px-6 mb-3">
      <summary class="flex items-center justify-between cursor-pointer py-1">
        <span>Security & Compliance</span>
        <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
      </summary>
      <div class="pt-2 text-sm">
        <div
          class="pl-1 flex justify-between items-center gap-2 mb-1 cursor-pointer"
          onclick={(e) => goToWorkloads("armorhub")}
          onkeydown={(e) => handleKeypress(e, () => goToWorkloads("armorhub"))}
          role="button"
          tabindex="0"
        >
          <span>KubeArmor</span>
          <Badge
            class="text-white {armorSummary?.status === 'ok' ? 'bg-emerald-600' : 'bg-slate-500'}"
          >
            {armorSummary?.status === "ok" ? "detected" : "not detected"}
          </Badge>
        </div>
        <div
          class="pl-1 flex justify-between items-center gap-2 mb-1 cursor-pointer"
          onclick={(e) => goToWorkloads("compliancehub")}
          onkeydown={(e) => handleKeypress(e, () => goToWorkloads("compliancehub"))}
          role="button"
          tabindex="0"
        >
          <span>Compliance Hub</span>
          <Badge
            class="text-white {complianceProblemCount > 0
              ? 'bg-amber-600'
              : complianceSummaryStatus === 'ok'
                ? 'bg-emerald-600'
                : 'bg-slate-500'}"
          >
            {complianceProblemCount > 0 ? `${complianceProblemCount} findings` : "no findings"}
          </Badge>
        </div>
        <div
          class="pl-1 flex justify-between items-center gap-2 mb-1 cursor-pointer"
          onclick={(e) => goToWorkloads("trivyhub")}
          onkeydown={(e) => handleKeypress(e, () => goToWorkloads("trivyhub"))}
          role="button"
          tabindex="0"
        >
          <span>Trivy</span>
          <Badge
            class="text-white {trivySummary?.status === 'ok' ? 'bg-emerald-600' : 'bg-slate-500'}"
          >
            {trivySummary?.status === "ok" ? "detected" : "not detected"}
          </Badge>
        </div>
      </div>
    </details>
    <details class="group px-6 mb-3">
      <summary class="flex items-center justify-between cursor-pointer py-1">
        <span>Observability</span>
        <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
      </summary>
      <div class="pt-2 text-sm">
        <div
          class="pl-1 flex justify-between items-center gap-2 mb-1 cursor-pointer"
          onclick={(e) => goToWorkloads("alertshub")}
          onkeydown={(e) => handleKeypress(e, () => goToWorkloads("alertshub"))}
          role="button"
          tabindex="0"
        >
          <span>Cluster Alerts</span>
          <Badge class="text-white {activeAlertsCount > 0 ? 'bg-amber-600' : 'bg-emerald-600'}">
            {activeAlertsCount} active
          </Badge>
        </div>
        <div
          class="pl-1 flex justify-between items-center gap-2 mb-1 cursor-pointer"
          onclick={(e) => goToWorkloads("metricssources")}
          onkeydown={(e) => handleKeypress(e, () => goToWorkloads("metricssources"))}
          role="button"
          tabindex="0"
        >
          <span>Metrics Sources</span>
          <Badge
            class="text-white {metricsTotalCount > 0 && metricsAvailableCount === metricsTotalCount
              ? 'bg-emerald-600'
              : 'bg-amber-600'}"
          >
            {metricsAvailableCount}/{metricsTotalCount}
          </Badge>
        </div>
      </div>
    </details>
    {#if effectiveLinter}
      <details class="group px-6 mb-3">
        <summary class="flex items-center justify-between cursor-pointer py-1">
          <span>Configuration check</span>
          <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
        </summary>
        {#if !canShowConfigDiagnostics}
          <div
            class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-100/95 px-3 py-2.5 text-sm font-medium leading-5 text-amber-950 shadow-sm"
          >
            <div class="pr-2">
              <div>Configuration diagnostics are not loaded yet.</div>
              <div class="text-[11px] font-normal text-amber-900/80">
                Fleet policy allows up to {effectiveRuntimeBudget.maxConcurrentDiagnostics} diagnostics
                at once.
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              class="h-8 shrink-0 border-amber-400 bg-white px-2.5 text-xs font-semibold text-amber-950 hover:bg-amber-50"
              onclick={() => requestCardDiagnostics("config")}
            >
              {#if activeCardDiagnosticsScope === "config"}
                Loading<LoadingDots />
              {:else if isDiagnosticsScopeQueued("config")}
                Queued by policy
              {:else}
                Load diagnostics
              {/if}
            </Button>
          </div>
        {/if}
        <div>
          <ResourcesHygiene report={resourcesHygiene} clusterId={cluster.uuid} />
          <HpaStatus report={hpaStatus} clusterId={cluster.uuid} />
          <ProbesHealth report={probesHealth} clusterId={cluster.uuid} />
          <PodQos report={podQos} clusterId={cluster.uuid} />
          <VpaStatus report={vpaStatus} clusterId={cluster.uuid} />
          <TopologyHa report={topologyHa} clusterId={cluster.uuid} />
          <PdbStatus report={pdbStatus} clusterId={cluster.uuid} />
          <PriorityStatus report={priorityStatus} clusterId={cluster.uuid} />
          <PodSecurity report={podSecurity} clusterId={cluster.uuid} />
          <NetworkIsolation report={networkIsolation} clusterId={cluster.uuid} />
          <SecretsHygiene report={secretsHygiene} clusterId={cluster.uuid} />
          <SecurityHardening report={securityHardening} clusterId={cluster.uuid} />
        </div>
      </details>
      <details class="group px-6 mb-3">
        <summary class="flex items-center justify-between cursor-pointer py-1">
          <span>Infrastructure</span>
          <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
        </summary>
        {#if !hasInfrastructureSnapshot}
          <div
            class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-teal-300 bg-teal-100/95 px-3 py-2.5 text-sm font-medium leading-5 text-teal-950 shadow-sm"
          >
            <div class="pr-2">
              <div>Infrastructure checks are not loaded yet.</div>
              <div class="text-[11px] font-normal text-teal-900/80">
                Fleet policy allows up to {effectiveRuntimeBudget.maxConcurrentDiagnostics} diagnostics
                at once.
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              class="h-8 shrink-0 border-teal-400 bg-white px-2.5 text-xs font-semibold text-teal-950 hover:bg-teal-50"
              onclick={() => requestCardDiagnostics("infrastructure")}
            >
              {#if activeCardDiagnosticsScope === "infrastructure"}
                Loading<LoadingDots />
              {:else if isDiagnosticsScopeQueued("infrastructure")}
                Queued by policy
              {:else}
                Load infrastructure
              {/if}
            </Button>
          </div>
        {/if}
        <div>
          <IngressStatus report={ingressStatus} clusterId={cluster.uuid} />
          <StorageStatus report={storageStatus} clusterId={cluster.uuid} />
          <NodeUtilizationStatus report={nodeUtilization} clusterId={cluster.uuid} />
          <ResourceQuotasStatus report={resourceQuotas} clusterId={cluster.uuid} />
          <LimitRangesStatus report={limitRanges} clusterId={cluster.uuid} />
          <RbacOverviewStatus report={rbacOverview} clusterId={cluster.uuid} />
          <ServiceMeshStatus report={serviceMesh} clusterId={cluster.uuid} />
          <ImageFreshnessStatus report={imageFreshness} />
        </div>
      </details>
      {#if lastCheck}
        <details class="group px-6 mb-3">
          <summary class="flex items-center justify-between cursor-pointer py-1">
            <span>Health checks</span>
            <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
          </summary>
          {#if !canShowHealthDiagnostics}
            <div
              class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-sky-300 bg-sky-100/95 px-3 py-2.5 text-sm font-medium leading-5 text-sky-950 shadow-sm"
            >
              <div class="pr-2">
                <div>Health diagnostics are not loaded yet.</div>
                <div class="text-[11px] font-normal text-sky-900/80">
                  Fleet policy allows up to {effectiveRuntimeBudget.maxConcurrentDiagnostics} diagnostics
                  at once.
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                class="h-8 shrink-0 border-sky-400 bg-white px-2.5 text-xs font-semibold text-sky-950 hover:bg-sky-50"
                onclick={() => requestCardDiagnostics("health")}
              >
                {#if activeCardDiagnosticsScope === "health"}
                  Loading<LoadingDots />
                {:else if isDiagnosticsScopeQueued("health")}
                  Queued by policy
                {:else}
                  Load diagnostics
                {/if}
              </Button>
            </div>
          {/if}

          <div>
            <div
              class="pl-1 flex justify-between items-center gap-2 mb-1 text-sm cursor-pointer"
              onclick={handlePodsClick}
              onkeydown={(e) => handleKeypress(e, handlePodsClick)}
              role="button"
              tabindex="0"
            >
              <PodrestartsCount {podRestarts} />
            </div>
            <div
              class="pl-1 flex justify-between items-center gap-2 mb-1 text-sm cursor-pointer"
              onclick={(e) => goToWorkloads("cronjobshealth")}
              onkeydown={(e) => handleKeypress(e, () => goToWorkloads("cronjobshealth"))}
              role="button"
              tabindex="0"
            >
              <CronjobsCount {cronJobCount} {cronJobsHealth} />
            </div>
            <div
              class="pl-1 flex justify-between items-center gap-2 mb-1 text-sm cursor-pointer"
              onclick={handleNodesClick}
              onkeydown={(e) => handleKeypress(e, handleNodesClick)}
              role="button"
              tabindex="0"
            >
              <NodesStatus checks={lastCheck as ClusterHealthChecks} />
            </div>
            <CertificatesHealth health={certificatesHealth} clusterId={cluster.uuid} />
            <PodIssues health={podIssues} clusterId={cluster.uuid} />
            <WarningEvents health={warningEvents} clusterId={cluster.uuid} />
            <BlackboxProbes health={blackboxProbes} clusterId={cluster.uuid} />
            {#if lastCheck && "metricsChecks" in lastCheck}
              {#each Object.values(sortedMetrics) as metric (metric.title)}
                <MetricsStatus metrics={metric} clusterId={cluster.uuid} onRefresh={refreshData} />
              {/each}
            {/if}
            <ApiServerHealth health={apiServerHealth} />
            <ApiServerLatency health={apiServerLatency} clusterId={cluster.uuid} />
            <AdmissionWebhooks health={admissionWebhooks} clusterId={cluster.uuid} />
            <ApfHealth health={apfHealth} clusterId={cluster.uuid} />
            <EtcdHealth health={etcdHealth} clusterId={cluster.uuid} />
          </div>
        </details>
      {/if}
      <div class="px-6 mb-3 cursor-pointer">
        <ClusterHealthScore checks={scoredChecks} />
      </div>
      <div class="px-6 mb-3 cursor-pointer">
        <ClusterScore checks={scoredChecks} />
      </div>
    {/if}
  </Card.Root>
{:else}
  <div class="text-red-600">Error while loading cluster data...</div>
{/if}
