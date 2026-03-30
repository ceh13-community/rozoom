import {
  parseNamespaces,
  parsePodRestarts,
  parseNodes,
  parseMetricsServiceStatus,
  parseControlPlaneComponents,
} from "../api/parsers";
import {
  getClusterCacheChecks,
  recoverHealthChecksCache,
  selectPreferredClusterCheck,
  setClusterCheck,
} from "./cache-store";
import { checkKubelet } from "../api/check-kubelet";
import { checkMetricsServer } from "../api/check-metrics-server";
import { checkKubeStateMetrics } from "../api/check-kube-state-metrics";
import { checkNodeExporter } from "../api/check-node-exporter";
import { checkApiServerHealth } from "../api/check-api-server-health";
import { checkApiServerLatency } from "../api/check-api-server-latency";
import { checkEtcdHealth } from "../api/check-etcd-health";
import { checkApfHealth } from "../api/check-apf-health";
import { checkCertificatesHealth } from "../api/check-certificates-health";
import { checkPodIssues } from "../api/check-pod-issues";
import { checkAdmissionWebhooks } from "../api/check-admission-webhooks";
import { checkWarningEvents } from "../api/check-warning-events";
import { checkBlackboxProbes } from "../api/check-blackbox-probes";
import { checkResourcesHygiene } from "../api/check-resources-hygiene";
import { checkHpaStatus } from "../api/check-hpa";
import { checkProbesHealth } from "../api/check-probes-health";
import { checkPodQos } from "../api/check-pod-qos";
import { checkTopologyHa } from "../api/check-topology-ha";
import { checkPdbStatus } from "../api/check-pdb";
import { checkPriorityStatus } from "../api/check-priority";
import { checkPodSecurity } from "../api/check-pod-security";
import { checkSecurityHardening } from "../api/check-security-hardening";
import { checkNetworkIsolation } from "../api/check-network-isolation";
import { checkSecretsHygiene } from "../api/check-secrets-hygiene";
import { loadClusterEntities } from "../api/get-cluster-info";
import { buildCronJobsHealth } from "../api/cronjobs-health";
import type {
  ApfHealthReport,
  BlackboxProbeReport,
  CertificatesReport,
  ClusterCheckError,
  ClusterHealthChecks,
  EtcdHealthReport,
  MetricsChecks,
} from "./types";
import { clusterStates } from "./watchers";
import {
  buildRecommendations,
  getMetricsSourceCapabilities,
} from "../api/resolvers/metrics-capabilities";
import { discoverPrometheusService } from "$shared/api/discover-prometheus";

import { isDashboardFeatureRouteActive } from "$shared/lib/dashboard-route-activity";
import { get } from "svelte/store";
import { clusterHealthChecks } from "./cache-store";
import { writeRuntimeDebugLog } from "$shared/lib/runtime-debug";
import type { ClusterData, CronJobItem, JobItem, PodItem } from "$shared/model/clusters";
import { getDiagnosticsScopeLoadedAt } from "./diagnostics-scope-state";

const METRICS_DEFERRED_MESSAGE = "Deferred to Metrics Sources page";
const MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE = "Managed control plane: deferred to cloud provider.";
const DASHBOARD_CACHE_PERSIST_MIN_AGE_MS = 60_000;
const DASHBOARD_DIAGNOSTICS_CACHE_TTL_MS = 5 * 60_000;
const DASHBOARD_DIAGNOSTICS_ENTITY_CACHE_TTL_MS = 45_000;
export type CollectClusterDataMode =
  | "dashboard"
  | "dashboardDiagnostics"
  | "dashboardConfigDiagnostics"
  | "dashboardHealthDiagnostics"
  | "full";

async function readPreviousHealthCheck(clusterId: string): Promise<ClusterHealthChecks | null> {
  try {
    const checks = await getClusterCacheChecks(clusterId);
    const selected = selectPreferredClusterCheck(checks);
    if (!selected || ("errors" in selected && selected.errors)) return null;
    return selected as ClusterHealthChecks;
  } catch (error) {
    await recoverHealthChecksCache(error);
    return null;
  }
}

function readPreviousDashboardCheck(clusterId: string): ClusterHealthChecks | null {
  const current = get(clusterHealthChecks)[clusterId];
  if (!current || "errors" in current) return null;
  return current;
}

function buildDeferredMetricsChecks(previous: ClusterHealthChecks | null): MetricsChecks {
  if (previous?.metricsChecks) {
    return previous.metricsChecks;
  }

  const checkedAt = new Date().toISOString();
  return {
    endpoints: {
      kubelet: {
        installed: true,
        error: undefined,
        lastSync: checkedAt,
        status: "Available",
        title: "Kubelet",
      },
      metrics_server: {
        installed: true,
        error: undefined,
        lastSync: checkedAt,
        status: "Available",
        title: "Metrics Server",
      },
      kube_state_metrics: {
        installed: true,
        error: METRICS_DEFERRED_MESSAGE,
        lastSync: checkedAt,
        status: "Available",
        title: "Kube State Metrics",
      },
      node_exporter: {
        installed: true,
        error: undefined,
        lastSync: checkedAt,
        status: "Available",
        title: "Node Exporter",
      },
    },
    pipeline: {
      fallbackOrder: ["api", "metrics_server", "node_exporter", "prometheus"],
      sources: [
        { id: "api", title: "Kubelet API", available: true, checkedAt },
        { id: "metrics_server", title: "metrics-server", available: true, checkedAt },
        { id: "node_exporter", title: "node-exporter", available: true, checkedAt },
        {
          id: "prometheus",
          title: "Prometheus",
          available: false,
          checkedAt,
          reason: METRICS_DEFERRED_MESSAGE,
        },
      ],
      recommendations: ["Open the Metrics Sources page to run full metrics diagnostics."],
      checkedAt,
    },
  };
}

function buildDeferredBlackboxReport(
  previous: ClusterHealthChecks | null,
): BlackboxProbeReport | undefined {
  if (previous?.blackboxProbes) {
    return previous.blackboxProbes;
  }

  return undefined;
}

function isMetricsServerAvailable(metricsChecks: MetricsChecks | null | undefined): boolean {
  const status = metricsChecks?.endpoints.metrics_server.status;
  if (Array.isArray(status)) return status.includes("Available");
  return typeof status === "string" && status.includes("Available");
}

function entityItems<T>(value: { items?: T[] } | null | undefined): T[] {
  return Array.isArray(value?.items) ? value.items : [];
}

function ensureEntityBag<T extends { items?: unknown[] }>(value: T): T {
  return {
    ...value,
    items: entityItems(value),
  } as T;
}

function normalizeLoadedClusterData(loadedData: ClusterData): ClusterData {
  return {
    ...loadedData,
    pods: ensureEntityBag(loadedData.pods),
    nodes: ensureEntityBag(loadedData.nodes),
    deployments: ensureEntityBag(loadedData.deployments),
    replicasets: ensureEntityBag(loadedData.replicasets),
    daemonsets: ensureEntityBag(loadedData.daemonsets),
    statefulsets: ensureEntityBag(loadedData.statefulsets),
    jobs: ensureEntityBag(loadedData.jobs),
    cronjobs: ensureEntityBag(loadedData.cronjobs),
    configmaps: ensureEntityBag(loadedData.configmaps),
    namespaces: ensureEntityBag(loadedData.namespaces),
    networkpolicies: ensureEntityBag(loadedData.networkpolicies),
    poddisruptionbudgets: ensureEntityBag(loadedData.poddisruptionbudgets),
    priorityclasses: ensureEntityBag(loadedData.priorityclasses),
  };
}

type DiagnosticsEntitySnapshot = {
  fetchedAt: number;
  entities: Set<EntityName>;
  data: ClusterData;
};

const dashboardDiagnosticsEntitySnapshots = new Map<string, DiagnosticsEntitySnapshot>();

function hasRequiredDiagnosticsEntities(
  snapshot: DiagnosticsEntitySnapshot | undefined,
  requiredEntities: readonly EntityName[],
): snapshot is DiagnosticsEntitySnapshot {
  if (!snapshot) return false;
  if (Date.now() - snapshot.fetchedAt > DASHBOARD_DIAGNOSTICS_ENTITY_CACHE_TTL_MS) {
    return false;
  }

  return requiredEntities.every((entity) => snapshot.entities.has(entity));
}

function rememberDiagnosticsEntities(
  clusterId: string,
  entities: readonly EntityName[],
  data: ClusterData,
) {
  dashboardDiagnosticsEntitySnapshots.set(clusterId, {
    fetchedAt: Date.now(),
    entities: new Set(entities),
    data,
  });
}

export function resetDashboardDiagnosticsEntitySnapshots() {
  dashboardDiagnosticsEntitySnapshots.clear();
}

function isManagedCluster(clusterData: {
  nodes?: { items?: Array<{ spec?: { providerID?: string } }> };
}): boolean {
  const providerIds = entityItems(clusterData.nodes)
    .map((item) => item.spec?.providerID?.trim().toLowerCase())
    .filter((providerId): providerId is string => Boolean(providerId));
  // Prefixes for providers with fully managed control planes.
  // hcloud:// and hrobot:// (Hetzner) are NOT managed - no first-party K8s service.
  const managedPrefixes = [
    "aws://",
    "gce://",
    "azure://",
    "do://",
    "oci://",
    "ibm://",
    "linode://",
    "openstack://",
    "scaleway://",
    "vultr://",
    "civo://",
  ];
  return providerIds.some((providerId) =>
    managedPrefixes.some((prefix) => providerId.startsWith(prefix)),
  );
}

function buildDeferredCertificatesReport(previous: ClusterHealthChecks | null): CertificatesReport {
  if (previous?.certificatesHealth) {
    return previous.certificatesHealth;
  }

  const updatedAt = Date.now();
  return {
    status: "unknown",
    summary: {
      status: "unknown",
      message: MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE,
      warnings: [MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE],
      updatedAt,
    },
    certificates: [],
    kubeletRotation: [],
    errors: MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE,
    updatedAt,
  };
}

function buildDeferredApfHealthReport(previous: ClusterHealthChecks | null): ApfHealthReport {
  if (previous?.apfHealth) {
    return previous.apfHealth;
  }

  const updatedAt = Date.now();
  return {
    status: "unknown",
    summary: {
      status: "unknown",
      message: MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE,
      warnings: [MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE],
      updatedAt,
    },
    metrics: null,
    metricRates: {},
    errors: MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE,
    updatedAt,
  };
}

function buildDeferredEtcdHealthReport(previous: ClusterHealthChecks | null): EtcdHealthReport {
  if (previous?.etcdHealth) {
    return previous.etcdHealth;
  }

  const updatedAt = Date.now();
  return {
    status: "unknown",
    summary: {
      status: "unknown",
      warnings: [MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE],
      updatedAt,
    },
    health: [],
    endpointStatus: [],
    metrics: [],
    metricRates: {},
    errors: MANAGED_CONTROL_PLANE_DEFERRED_MESSAGE,
    updatedAt,
  };
}

function buildDeferredCronJobsHealth(previous: ClusterHealthChecks | null) {
  if (previous?.cronJobsHealth) {
    return previous.cronJobsHealth;
  }

  return {
    items: [],
    summary: {
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      unknown: 0,
    },
    updatedAt: Date.now(),
  };
}

const fetchMetricsStatuses = async (clusterUuid: string): Promise<MetricsChecks> => {
  const kubeletStatus = await checkKubelet(clusterUuid);
  const metricsServerStatus = await checkMetricsServer(clusterUuid);
  const kubeStateMetricsStatus = await checkKubeStateMetrics(clusterUuid);
  const nodeExporterStatus = await checkNodeExporter(clusterUuid);
  const prometheusService = await discoverPrometheusService(clusterUuid).catch(() => null);
  const capabilities = await getMetricsSourceCapabilities(clusterUuid, {
    force: true,
    probes: {
      kubelet: kubeletStatus,
      metricsServer: metricsServerStatus,
      nodeExporter: nodeExporterStatus,
      prometheusService,
    },
  });
  const recommendations = buildRecommendations(capabilities);

  return {
    endpoints: {
      kubelet: {
        ...kubeletStatus,
        status: parseMetricsServiceStatus(kubeletStatus.status, "detailed"),
      },
      metrics_server: {
        ...metricsServerStatus,
        status: parseMetricsServiceStatus(metricsServerStatus.status),
      },
      kube_state_metrics: {
        ...kubeStateMetricsStatus,
        status: parseMetricsServiceStatus(kubeStateMetricsStatus.status),
      },
      node_exporter: {
        ...nodeExporterStatus,
        status: parseMetricsServiceStatus(nodeExporterStatus.status, "detailed"),
      },
    },
    pipeline: {
      fallbackOrder: ["api", "metrics_server", "node_exporter", "prometheus"],
      sources: capabilities,
      recommendations,
      checkedAt: new Date().toISOString(),
    },
  };
};

function getEntitiesForMode(mode: CollectClusterDataMode) {
  if (mode === "dashboard") {
    return ["pods", "nodes", "deployments", "replicasets"] as const;
  }

  if (mode === "dashboardConfigDiagnostics") {
    return [
      "pods",
      "nodes",
      "deployments",
      "daemonsets",
      "statefulsets",
      "jobs",
      "cronjobs",
      "configmaps",
      "namespaces",
      "networkpolicies",
      "poddisruptionbudgets",
      "priorityclasses",
    ] as const;
  }

  if (mode === "dashboardHealthDiagnostics") {
    return ["pods", "nodes", "jobs", "cronjobs"] as const;
  }

  if (mode === "dashboardDiagnostics") {
    return [
      "pods",
      "nodes",
      "deployments",
      "replicasets",
      "daemonsets",
      "statefulsets",
      "jobs",
      "cronjobs",
      "configmaps",
      "namespaces",
      "networkpolicies",
      "poddisruptionbudgets",
      "priorityclasses",
    ] as const;
  }

  return [
    "pods",
    "nodes",
    "deployments",
    "replicasets",
    "daemonsets",
    "statefulsets",
    "jobs",
    "cronjobs",
    "configmaps",
    "namespaces",
    "networkpolicies",
    "poddisruptionbudgets",
    "priorityclasses",
  ] as const;
}

function getDashboardBootstrapEntities(previousCheck: ClusterHealthChecks | null) {
  const entities = ["pods", "deployments", "replicasets"] as EntityName[];

  if (!previousCheck?.nodes) {
    entities.push("nodes");
  }

  if (!hasDashboardSlowSnapshot(previousCheck)) {
    entities.push("daemonsets", "statefulsets", "jobs", "cronjobs", "namespaces");
  }

  return entities;
}

function getDashboardDiagnosticsBootstrapEntities() {
  return [
    "pods",
    "nodes",
    "deployments",
    "replicasets",
    "daemonsets",
    "statefulsets",
    "jobs",
    "cronjobs",
    "configmaps",
    "namespaces",
    "networkpolicies",
    "poddisruptionbudgets",
    "priorityclasses",
  ] as EntityName[];
}

type EntityName = ReturnType<typeof getEntitiesForMode>[number];

function hasDashboardSlowSnapshot(previousCheck: ClusterHealthChecks | null): boolean {
  if (!previousCheck) return false;

  return (
    typeof previousCheck.daemonSets === "number" &&
    typeof previousCheck.statefulSets === "number" &&
    typeof previousCheck.jobs === "number" &&
    typeof previousCheck.cronJobs === "number" &&
    Array.isArray(previousCheck.namespaces) &&
    previousCheck.namespaces.length > 0
  );
}

function hasDashboardDiagnosticsSnapshot(previousCheck: ClusterHealthChecks | null): boolean {
  if (!previousCheck) return false;

  return Boolean(
    previousCheck.resourcesHygiene &&
      previousCheck.hpaStatus &&
      previousCheck.probesHealth &&
      previousCheck.podQos &&
      previousCheck.vpaStatus &&
      previousCheck.topologyHa &&
      previousCheck.pdbStatus &&
      previousCheck.priorityStatus &&
      previousCheck.podSecurity &&
      previousCheck.networkIsolation &&
      previousCheck.secretsHygiene &&
      previousCheck.securityHardening &&
      previousCheck.podIssues &&
      previousCheck.apiServerHealth,
  );
}

function hasFreshDashboardDiagnosticsSnapshot(previousCheck: ClusterHealthChecks | null): boolean {
  if (!hasDashboardDiagnosticsSnapshot(previousCheck)) return false;
  const configLoadedAt = getDiagnosticsScopeLoadedAt(previousCheck, "config");
  const healthLoadedAt = getDiagnosticsScopeLoadedAt(previousCheck, "health");
  return (
    configLoadedAt > 0 &&
    healthLoadedAt > 0 &&
    Date.now() - Math.min(configLoadedAt, healthLoadedAt) < DASHBOARD_DIAGNOSTICS_CACHE_TTL_MS
  );
}

function hasDashboardConfigDiagnosticsSnapshot(previousCheck: ClusterHealthChecks | null): boolean {
  if (!previousCheck) return false;

  return Boolean(
    previousCheck.resourcesHygiene &&
      previousCheck.hpaStatus &&
      previousCheck.probesHealth &&
      previousCheck.podQos &&
      previousCheck.vpaStatus &&
      previousCheck.topologyHa &&
      previousCheck.pdbStatus &&
      previousCheck.priorityStatus &&
      previousCheck.podSecurity &&
      previousCheck.networkIsolation &&
      previousCheck.secretsHygiene &&
      previousCheck.securityHardening,
  );
}

function hasDashboardHealthDiagnosticsSnapshot(previousCheck: ClusterHealthChecks | null): boolean {
  if (!previousCheck) return false;

  // Check that health data is real, not deferred stubs (status: "unknown")
  const hasRealApiServer =
    previousCheck.apiServerHealth && previousCheck.apiServerHealth.status !== "unknown";

  return Boolean(
    hasRealApiServer &&
      previousCheck.apiServerLatency &&
      previousCheck.podIssues &&
      previousCheck.warningEvents &&
      Array.isArray(previousCheck.podRestarts) &&
      previousCheck.cronJobsHealth,
  );
}

function hasFreshDashboardConfigDiagnosticsSnapshot(
  previousCheck: ClusterHealthChecks | null,
): boolean {
  if (!hasDashboardConfigDiagnosticsSnapshot(previousCheck)) return false;
  const loadedAt = getDiagnosticsScopeLoadedAt(previousCheck, "config");
  return loadedAt > 0 && Date.now() - loadedAt < DASHBOARD_DIAGNOSTICS_CACHE_TTL_MS;
}

function hasFreshDashboardHealthDiagnosticsSnapshot(
  previousCheck: ClusterHealthChecks | null,
): boolean {
  if (!hasDashboardHealthDiagnosticsSnapshot(previousCheck)) return false;
  const loadedAt = getDiagnosticsScopeLoadedAt(previousCheck, "health");
  return loadedAt > 0 && Date.now() - loadedAt < DASHBOARD_DIAGNOSTICS_CACHE_TTL_MS;
}

function shouldPersistDashboardCheck(previousCheck: ClusterHealthChecks | null): boolean {
  if (!previousCheck) return true;
  if (typeof previousCheck.timestamp !== "number") return true;
  return Date.now() - previousCheck.timestamp >= DASHBOARD_CACHE_PERSIST_MIN_AGE_MS;
}

export async function collectClusterData(
  clusterId: string,
  options: { shouldStop?: () => boolean; mode?: CollectClusterDataMode } = {},
): Promise<ClusterHealthChecks | ClusterCheckError | null> {
  const startedAt = Date.now();
  const isStopped = () => options.shouldStop?.() ?? false;
  const entityAbortController = new AbortController();
  const entityAbortPoll =
    typeof window === "undefined"
      ? null
      : window.setInterval(() => {
          if (isStopped()) {
            entityAbortController.abort();
          }
        }, 50);
  const mode = options.mode ?? "full";
  const dashboardLightMode = mode === "dashboard";
  const dashboardDiagnosticsMode =
    mode === "dashboardDiagnostics" ||
    mode === "dashboardConfigDiagnostics" ||
    mode === "dashboardHealthDiagnostics";
  const dashboardConfigDiagnosticsMode =
    mode === "dashboardDiagnostics" || mode === "dashboardConfigDiagnostics";
  const dashboardHealthDiagnosticsMode =
    mode === "dashboardDiagnostics" || mode === "dashboardHealthDiagnostics";
  const previousCheck =
    dashboardLightMode || dashboardDiagnosticsMode
      ? (readPreviousDashboardCheck(clusterId) ?? (await readPreviousHealthCheck(clusterId)))
      : await readPreviousHealthCheck(clusterId);

  if (
    dashboardDiagnosticsMode &&
    ((mode === "dashboardDiagnostics" && hasFreshDashboardDiagnosticsSnapshot(previousCheck)) ||
      (mode === "dashboardConfigDiagnostics" &&
        hasFreshDashboardConfigDiagnosticsSnapshot(previousCheck)) ||
      (mode === "dashboardHealthDiagnostics" &&
        hasFreshDashboardHealthDiagnosticsSnapshot(previousCheck)))
  ) {
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
    void writeRuntimeDebugLog("watchers", "collect_reuse_diagnostics_snapshot", {
      clusterId,
      mode,
      ageMs: Date.now() - (previousCheck?.timestamp ?? Date.now()),
    });
    return previousCheck;
  }
  const reuseDashboardSlowEntities = dashboardLightMode && hasDashboardSlowSnapshot(previousCheck);
  const bootstrapDashboardDiagnostics = dashboardDiagnosticsMode;
  const shouldLoadDashboardNodes = !dashboardLightMode || !previousCheck?.nodes;
  const entitiesToFetch = dashboardLightMode
    ? getDashboardBootstrapEntities(previousCheck)
    : [...getEntitiesForMode(mode)];
  const reusableDiagnosticsSnapshot =
    dashboardDiagnosticsMode && !dashboardLightMode
      ? dashboardDiagnosticsEntitySnapshots.get(clusterId)
      : undefined;
  clusterStates.update((states) => ({
    ...states,
    [clusterId]: { loading: true, error: null },
  }));
  const loadedData =
    reusableDiagnosticsSnapshot &&
    hasRequiredDiagnosticsEntities(reusableDiagnosticsSnapshot, entitiesToFetch)
      ? reusableDiagnosticsSnapshot.data
      : await loadClusterEntities(
          { uuid: clusterId },
          {
            entities: [...entitiesToFetch],
            testEntity: dashboardLightMode && !shouldLoadDashboardNodes ? "pods" : "nodes",
            signal: entityAbortController.signal,
            lightweight: dashboardLightMode,
            maxConcurrency: dashboardDiagnosticsMode ? 1 : undefined,
          },
        );
  if (
    reusableDiagnosticsSnapshot &&
    hasRequiredDiagnosticsEntities(reusableDiagnosticsSnapshot, entitiesToFetch)
  ) {
    await writeRuntimeDebugLog("watchers", "collect_reuse_diagnostics_entities", {
      clusterId,
      mode,
      ageMs: Date.now() - reusableDiagnosticsSnapshot.fetchedAt,
      entities: entitiesToFetch,
    });
  }
  await writeRuntimeDebugLog("watchers", "collect_entities_loaded", {
    clusterId,
    mode,
    durationMs: Date.now() - startedAt,
    dashboardLightMode,
    hasPreviousCheck: Boolean(previousCheck),
  });
  if (entityAbortPoll) {
    clearInterval(entityAbortPoll);
  }

  if (isStopped()) {
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
    return null;
  }
  if (loadedData.status !== "ok") {
    const errorText = loadedData.errors ?? "Failed to load cluster data";
    // Treat abort errors as cancellation - don't persist error state
    const isAborted =
      errorText.includes("aborted") || errorText.includes("AbortError") || isStopped();
    if (isAborted) {
      clusterStates.update((states) => ({
        ...states,
        [clusterId]: { loading: false, error: null },
      }));
      return null;
    }
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: errorText },
    }));

    return {
      errors: errorText,
      timestamp: Date.now(),
    };
  }
  const normalizedData = normalizeLoadedClusterData(loadedData);
  if (dashboardDiagnosticsMode && !dashboardLightMode) {
    rememberDiagnosticsEntities(clusterId, entitiesToFetch, normalizedData);
  }
  const dashboardDiagnosticsData =
    bootstrapDashboardDiagnostics && dashboardLightMode
      ? await loadClusterEntities(
          { uuid: clusterId },
          {
            entities: [...getDashboardDiagnosticsBootstrapEntities()],
            testEntity: "pods",
            signal: entityAbortController.signal,
            lightweight: false,
          },
        )
      : null;
  const normalizedDiagnosticsData =
    dashboardDiagnosticsData && dashboardDiagnosticsData.status === "ok"
      ? normalizeLoadedClusterData(dashboardDiagnosticsData)
      : null;
  const diagnosticsData = dashboardDiagnosticsMode
    ? normalizedData
    : (normalizedDiagnosticsData ?? normalizedData);
  const allowHeavyObservabilityProbes = isDashboardFeatureRouteActive(clusterId, {
    workloads: ["metricssources"],
  });
  const metricsChecks =
    !dashboardLightMode && allowHeavyObservabilityProbes
      ? await fetchMetricsStatuses(clusterId)
      : buildDeferredMetricsChecks(previousCheck);
  if (isStopped()) {
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
    return null;
  }
  const metricsServerAvailable = isMetricsServerAvailable(metricsChecks);
  const managedCluster = isManagedCluster(normalizedData);
  const podItems = entityItems(normalizedData.pods);
  const daemonSetItems = entityItems(normalizedData.daemonsets);
  const deploymentItems = entityItems(normalizedData.deployments);
  const jobItems = entityItems(normalizedData.jobs);
  const replicaSetItems = entityItems(normalizedData.replicasets);
  const statefulSetItems = entityItems(normalizedData.statefulsets);
  const cronJobItems = entityItems(normalizedData.cronjobs);
  const namespaceItems = entityItems(normalizedData.namespaces);
  const nodeItems = entityItems(normalizedData.nodes);
  const usePreviousDaemonSets = dashboardLightMode && reuseDashboardSlowEntities;
  const usePreviousStatefulSets = dashboardLightMode && reuseDashboardSlowEntities;
  const usePreviousJobs = dashboardLightMode && reuseDashboardSlowEntities;
  const usePreviousCronJobs = dashboardLightMode && reuseDashboardSlowEntities;
  const usePreviousNamespaces = dashboardLightMode && reuseDashboardSlowEntities;
  const diagnosticsPodItems = entityItems<PodItem>(diagnosticsData.pods);

  const [
    apiServerHealth,
    apiServerLatency,
    certificatesHealth,
    podIssues,
    admissionWebhooks,
    warningEvents,
    blackboxProbes,
    apfHealth,
    etcdHealth,
    resourcesHygiene,
    hpaStatus,
    probesHealth,
    podQos,
    vpaStatus,
    topologyHa,
    pdbStatus,
    priorityStatus,
    podSecurity,
    networkIsolation,
    secretsHygiene,
    securityHardening,
  ] = await Promise.all([
    (dashboardLightMode && !bootstrapDashboardDiagnostics) || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.apiServerHealth)
      : checkApiServerHealth(clusterId),
    dashboardLightMode || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.apiServerLatency)
      : checkApiServerLatency(clusterId),
    dashboardLightMode || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.certificatesHealth)
      : managedCluster
        ? Promise.resolve(buildDeferredCertificatesReport(previousCheck))
        : checkCertificatesHealth(clusterId),
    dashboardLightMode
      ? bootstrapDashboardDiagnostics
        ? checkPodIssues(clusterId, { pods: diagnosticsPodItems })
        : Promise.resolve(previousCheck?.podIssues)
      : dashboardHealthDiagnosticsMode
        ? checkPodIssues(clusterId, { pods: podItems })
        : Promise.resolve(previousCheck?.podIssues),
    dashboardLightMode || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.admissionWebhooks)
      : checkAdmissionWebhooks(clusterId),
    dashboardLightMode || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.warningEvents)
      : checkWarningEvents(clusterId),
    !dashboardLightMode && !dashboardDiagnosticsMode && allowHeavyObservabilityProbes
      ? checkBlackboxProbes(clusterId)
      : Promise.resolve(buildDeferredBlackboxReport(previousCheck)),
    dashboardLightMode || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.apfHealth)
      : managedCluster
        ? Promise.resolve(buildDeferredApfHealthReport(previousCheck))
        : checkApfHealth(clusterId),
    dashboardLightMode || !dashboardHealthDiagnosticsMode
      ? Promise.resolve(previousCheck?.etcdHealth)
      : managedCluster
        ? Promise.resolve(buildDeferredEtcdHealthReport(previousCheck))
        : checkEtcdHealth(clusterId),
    dashboardLightMode
      ? bootstrapDashboardDiagnostics
        ? checkResourcesHygiene(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.resourcesHygiene)
      : dashboardConfigDiagnosticsMode
        ? checkResourcesHygiene(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.resourcesHygiene),
    dashboardLightMode
      ? bootstrapDashboardDiagnostics
        ? checkHpaStatus(clusterId, {
            data: diagnosticsData,
            metricsServerAvailable,
          })
        : Promise.resolve(previousCheck?.hpaStatus)
      : dashboardConfigDiagnosticsMode
        ? Promise.resolve(previousCheck?.hpaStatus)
        : Promise.resolve(previousCheck?.hpaStatus),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.probesHealth)
      : dashboardConfigDiagnosticsMode
        ? checkProbesHealth(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.probesHealth),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.podQos)
      : dashboardConfigDiagnosticsMode
        ? checkPodQos(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.podQos),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.vpaStatus)
      : dashboardConfigDiagnosticsMode
        ? Promise.resolve(previousCheck?.vpaStatus)
        : Promise.resolve(previousCheck?.vpaStatus),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.topologyHa)
      : dashboardConfigDiagnosticsMode
        ? checkTopologyHa(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.topologyHa),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.pdbStatus)
      : dashboardConfigDiagnosticsMode
        ? checkPdbStatus(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.pdbStatus),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.priorityStatus)
      : dashboardConfigDiagnosticsMode
        ? checkPriorityStatus(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.priorityStatus),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.podSecurity)
      : dashboardConfigDiagnosticsMode
        ? checkPodSecurity(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.podSecurity),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.networkIsolation)
      : dashboardConfigDiagnosticsMode
        ? checkNetworkIsolation(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.networkIsolation),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.secretsHygiene)
      : dashboardConfigDiagnosticsMode
        ? checkSecretsHygiene(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.secretsHygiene),
    dashboardLightMode && !bootstrapDashboardDiagnostics
      ? Promise.resolve(previousCheck?.securityHardening)
      : dashboardConfigDiagnosticsMode
        ? checkSecurityHardening(clusterId, { data: diagnosticsData })
        : Promise.resolve(previousCheck?.securityHardening),
  ]);
  if (isStopped()) {
    clusterStates.update((states) => ({
      ...states,
      [clusterId]: { loading: false, error: null },
    }));
    return null;
  }
  const cronJobsHealth = dashboardLightMode
    ? reuseDashboardSlowEntities
      ? buildDeferredCronJobsHealth(previousCheck)
      : normalizedDiagnosticsData
        ? buildCronJobsHealth(
            diagnosticsData.cronjobs as { items: CronJobItem[] },
            diagnosticsData.jobs as { items: JobItem[] },
          )
        : buildDeferredCronJobsHealth(previousCheck)
    : buildCronJobsHealth(
        diagnosticsData.cronjobs as { items: CronJobItem[] },
        diagnosticsData.jobs as { items: JobItem[] },
      );

  const checks = {
    cronJobs: usePreviousCronJobs ? (previousCheck?.cronJobs ?? 0) : cronJobItems.length || 0,
    cronJobsHealth,
    apiServerHealth,
    controlPlaneComponents: dashboardLightMode
      ? (previousCheck?.controlPlaneComponents ??
        (normalizedDiagnosticsData
          ? parseControlPlaneComponents({ ...diagnosticsData.pods, items: diagnosticsPodItems })
          : undefined))
      : parseControlPlaneComponents({ ...diagnosticsData.pods, items: diagnosticsPodItems }),
    apiServerLatency,
    certificatesHealth,
    podIssues,
    admissionWebhooks,
    warningEvents,
    blackboxProbes: allowHeavyObservabilityProbes
      ? blackboxProbes
      : buildDeferredBlackboxReport(previousCheck),
    apfHealth,
    etcdHealth,
    resourcesHygiene,
    hpaStatus,
    probesHealth,
    podQos,
    vpaStatus,
    topologyHa,
    pdbStatus,
    priorityStatus,
    podSecurity,
    networkIsolation,
    secretsHygiene,
    securityHardening,
    daemonSets: usePreviousDaemonSets
      ? (previousCheck?.daemonSets ?? 0)
      : daemonSetItems.length || 0,
    deployments: deploymentItems.length || 0,
    jobs: usePreviousJobs ? (previousCheck?.jobs ?? 0) : jobItems.length || 0,
    pods: podItems.length || 0,
    replicaSets: replicaSetItems.length || 0,
    statefulSets: usePreviousStatefulSets
      ? (previousCheck?.statefulSets ?? 0)
      : statefulSetItems.length || 0,
    namespaces: usePreviousNamespaces
      ? (previousCheck?.namespaces ?? [])
      : parseNamespaces({ ...normalizedData.namespaces, items: namespaceItems }),
    podRestarts: dashboardLightMode
      ? (previousCheck?.podRestarts ??
        (normalizedDiagnosticsData
          ? parsePodRestarts({ ...diagnosticsData.pods, items: diagnosticsPodItems })
          : []))
      : parsePodRestarts({ ...diagnosticsData.pods, items: diagnosticsPodItems }),
    nodes:
      dashboardLightMode && !shouldLoadDashboardNodes
        ? previousCheck.nodes
        : parseNodes({ ...normalizedData.nodes, items: nodeItems }),
    metricsChecks,
    diagnosticsSnapshots: previousCheck?.diagnosticsSnapshots,
    timestamp: Date.now(),
  };

  if (mode === "dashboardDiagnostics" || mode === "full") {
    checks.diagnosticsSnapshots = {
      configLoadedAt: checks.timestamp,
      healthLoadedAt: checks.timestamp,
    };
  } else if (mode === "dashboardConfigDiagnostics") {
    checks.diagnosticsSnapshots = {
      configLoadedAt: checks.timestamp,
      healthLoadedAt: previousCheck?.diagnosticsSnapshots?.healthLoadedAt,
    };
  } else if (mode === "dashboardHealthDiagnostics") {
    checks.diagnosticsSnapshots = {
      configLoadedAt: previousCheck?.diagnosticsSnapshots?.configLoadedAt,
      healthLoadedAt: checks.timestamp,
    };
  }

  const persistToCache = !dashboardLightMode || shouldPersistDashboardCheck(previousCheck);
  const persistPromise = setClusterCheck(clusterId, checks, { persistToCache });
  if (dashboardLightMode) {
    void persistPromise;
  } else {
    await persistPromise;
  }
  await writeRuntimeDebugLog("watchers", "collect_complete", {
    clusterId,
    mode,
    durationMs: Date.now() - startedAt,
    persistToCache,
    pods: checks.pods,
    deployments: checks.deployments,
    replicaSets: checks.replicaSets,
  });

  clusterStates.update((states) => ({
    ...states,
    [clusterId]: { loading: false, error: null },
  }));

  return checks;
}
