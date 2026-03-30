import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkResponseStatus } from "$shared/lib/parsers";
import type { DeploymentItem } from "$shared/model/clusters";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";

type MetricsServerStatus = {
  result: number;
};

type MetricsServerCheckResult = {
  error?: string;
  installed: boolean;
  managedBy?: "helm" | "kubectl";
  namespace?: string;
  releaseName?: string;
  lastSync: string;
  status: MetricsServerStatus[];
  title: "Metrics Server";
  url?: string;
};

const CHECK_METRICS_SERVER_CACHE_MS = 60_000;
const METRICS_SERVER_FEATURE_ID = "metrics-source:metrics_server";
const cachedReports = new Map<string, { data: MetricsServerCheckResult; fetchedAt: number }>();

type PodListItem = {
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
  };
  status?: {
    phase?: string;
    conditions?: Array<{ type?: string; status?: string }>;
    containerStatuses?: Array<{ ready?: boolean }>;
  };
};

const parseMetricsServerDeployment = (output: string) => {
  try {
    const json = JSON.parse(output) as { items?: DeploymentItem[] };
    const deployment = json.items?.find((item) => {
      const name = item.metadata.name.toLowerCase();
      const labels = item.metadata.labels ?? {};
      const k8sApp = (labels["k8s-app"] || "").toLowerCase();
      const appName = (labels["app.kubernetes.io/name"] || "").toLowerCase();
      return (
        k8sApp === "metrics-server" ||
        appName === "metrics-server" ||
        name === "metrics-server" ||
        name.includes("metrics-server")
      );
    });
    if (!deployment) return null;

    const managedByLabel = deployment.metadata.labels?.["app.kubernetes.io/managed-by"];
    const managedBy: "helm" | "kubectl" =
      managedByLabel?.toLowerCase() === "helm" ? "helm" : "kubectl";
    const releaseName = deployment.metadata.labels?.["app.kubernetes.io/instance"];
    const readyReplicas = deployment.status.readyReplicas;
    const availableReplicas = deployment.status.availableReplicas;
    const replicas = deployment.status.replicas;
    return {
      installed: true,
      managedBy,
      namespace: deployment.metadata.namespace,
      releaseName,
      ready: replicas > 0 && readyReplicas >= replicas && availableReplicas >= replicas,
    };
  } catch {
    return null;
  }
};

function parseItemsCount(output: string): number {
  const json = JSON.parse(output) as { items?: unknown[] };
  return Array.isArray(json.items) ? json.items.length : 0;
}

function parseMetricsServerReadyPods(
  output: string,
  namespace?: string,
): {
  matchingPods: number;
  readyPods: number;
} {
  const json = JSON.parse(output) as { items?: PodListItem[] };
  const items = Array.isArray(json.items) ? json.items : [];
  const matching = items.filter((pod) => {
    if (namespace && pod.metadata.namespace !== namespace) return false;
    const labels = pod.metadata.labels ?? {};
    const appName = (labels["app.kubernetes.io/name"] || "").toLowerCase();
    const k8sApp = (labels["k8s-app"] || "").toLowerCase();
    const name = (pod.metadata.name || "").toLowerCase();
    return (
      appName === "metrics-server" ||
      k8sApp === "metrics-server" ||
      name === "metrics-server" ||
      name.includes("metrics-server")
    );
  });

  const readyPods = matching.filter((pod) => {
    const readyCondition =
      pod.status?.conditions?.some(
        (condition) => condition.type === "Ready" && condition.status === "True",
      ) ?? false;
    const allContainersReady =
      (pod.status?.containerStatuses?.length ?? 0) > 0 &&
      (pod.status?.containerStatuses?.every((container) => container.ready === true) ?? false);
    const phaseRunning = (pod.status?.phase || "").toLowerCase() === "running";
    return phaseRunning && (readyCondition || allContainersReady);
  });

  return {
    matchingPods: matching.length,
    readyPods: readyPods.length,
  };
}

function cacheReport(clusterId: string, report: MetricsServerCheckResult) {
  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}

export function resetCheckMetricsServerCache() {
  cachedReports.clear();
}

export const checkMetricsServer = async (
  clusterId: string,
  options?: { force?: boolean },
): Promise<MetricsServerCheckResult> => {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CHECK_METRICS_SERVER_CACHE_MS) {
    return cached.data;
  }

  if (
    !options?.force &&
    shouldSkipFeatureProbe(clusterId, METRICS_SERVER_FEATURE_ID, {
      statuses: ["unsupported", "forbidden", "unreachable", "unavailable", "misconfigured"],
    })
  ) {
    const capability = getFeatureCapability(clusterId, METRICS_SERVER_FEATURE_ID);
    if (capability?.reason) {
      return cacheReport(clusterId, {
        error: capability.reason,
        installed: false,
        lastSync: new Date().toISOString(),
        status: [{ result: checkResponseStatus(capability.reason) }],
        title: "Metrics Server",
      });
    }
  }

  const results = [];
  const [nodesRaw, podsRaw, topNodes, clusterNodesRaw, deployment, podsStatusRaw] =
    await Promise.all([
      kubectlRawFront(`get --raw /apis/metrics.k8s.io/v1beta1/nodes`, { clusterId }),
      kubectlRawFront(`get --raw /apis/metrics.k8s.io/v1beta1/pods`, { clusterId }),
      kubectlRawFront("top nodes", { clusterId }),
      kubectlRawFront("get nodes -o json", { clusterId }),
      kubectlRawFront("get deployment -A -o json", {
        clusterId,
      }),
      kubectlRawFront("get pod -A -o json", {
        clusterId,
      }),
    ]);

  const deploymentInfo = deployment.errors.length
    ? null
    : parseMetricsServerDeployment(deployment.output);
  const installed = deploymentInfo?.installed ?? false;

  if (
    nodesRaw.errors.length ||
    podsRaw.errors.length ||
    topNodes.errors.length ||
    clusterNodesRaw.errors.length ||
    deployment.errors.length ||
    podsStatusRaw.errors.length
  ) {
    const errorText =
      nodesRaw.errors ||
      podsRaw.errors ||
      topNodes.errors ||
      clusterNodesRaw.errors ||
      deployment.errors ||
      podsStatusRaw.errors;
    const report: MetricsServerCheckResult = {
      error: errorText,
      installed,
      managedBy: deploymentInfo?.managedBy,
      namespace: deploymentInfo?.namespace,
      releaseName: deploymentInfo?.releaseName,
      lastSync: new Date().toISOString(),
      status: [{ result: checkResponseStatus(errorText) }],
      title: "Metrics Server",
    };
    markFeatureCapabilityFromReason(clusterId, METRICS_SERVER_FEATURE_ID, errorText);
    return cacheReport(clusterId, report);
  }

  let nodesCount = 0;
  let podsCount = 0;
  let clusterNodesCount = 0;
  let topNodesHasRows = false;
  let readyPods = 0;
  let matchingPods = 0;
  try {
    nodesCount = parseItemsCount(nodesRaw.output);
    podsCount = parseItemsCount(podsRaw.output);
    clusterNodesCount = parseItemsCount(clusterNodesRaw.output);
    const lines = topNodes.output
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0);
    topNodesHasRows = lines.length > 1;
    const podState = parseMetricsServerReadyPods(podsStatusRaw.output, deploymentInfo?.namespace);
    readyPods = podState.readyPods;
    matchingPods = podState.matchingPods;
  } catch (e) {
    const report: MetricsServerCheckResult = {
      error: (e as Error).message || "Unknown error",
      installed,
      managedBy: deploymentInfo?.managedBy,
      namespace: deploymentInfo?.namespace,
      releaseName: deploymentInfo?.releaseName,
      lastSync: new Date().toISOString(),
      status: [{ result: -1 }],
      title: "Metrics Server",
    };
    markFeatureCapabilityFromReason(clusterId, METRICS_SERVER_FEATURE_ID, report.error);
    return cacheReport(clusterId, report);
  }
  const allClusterNodesReported = clusterNodesCount > 0 && nodesCount >= clusterNodesCount;
  const metricsDataReady =
    nodesCount > 0 && podsCount > 0 && topNodesHasRows && allClusterNodesReported;
  const deploymentReady = deploymentInfo?.ready ?? false;
  const podsReady = matchingPods > 0 && readyPods === matchingPods;
  if (!installed) {
    const report: MetricsServerCheckResult = {
      error: "metrics-server deployment not found",
      installed: false,
      managedBy: deploymentInfo?.managedBy,
      namespace: deploymentInfo?.namespace,
      releaseName: deploymentInfo?.releaseName,
      lastSync: new Date().toISOString(),
      status: [{ result: -1 }],
      title: "Metrics Server",
    };
    markFeatureCapabilityFromReason(clusterId, METRICS_SERVER_FEATURE_ID, report.error);
    return cacheReport(clusterId, report);
  }

  if (metricsDataReady && deploymentReady && podsReady) {
    results.push({ result: 1 });
  } else {
    results.push({ result: 0 });
  }
  const errorMessage = !deploymentReady
    ? "metrics-server deployment is not Ready"
    : !podsReady
      ? "metrics-server pod is not Ready"
      : !metricsDataReady
        ? !allClusterNodesReported
          ? `metrics-server reports ${nodesCount}/${clusterNodesCount} nodes`
          : "metrics.k8s.io endpoints or kubectl top nodes returned empty data"
        : undefined;

  const report: MetricsServerCheckResult = {
    installed,
    managedBy: deploymentInfo?.managedBy,
    namespace: deploymentInfo?.namespace,
    releaseName: deploymentInfo?.releaseName,
    ...(errorMessage ? { error: errorMessage } : {}),
    lastSync: new Date().toISOString(),
    status: results,
    title: "Metrics Server",
    url: "/apis/metrics.k8s.io/v1beta1/nodes + /apis/metrics.k8s.io/v1beta1/pods + kubectl top nodes",
  };
  if (errorMessage) {
    markFeatureCapabilityFromReason(clusterId, METRICS_SERVER_FEATURE_ID, errorMessage);
  } else {
    markFeatureCapability(clusterId, METRICS_SERVER_FEATURE_ID, { status: "available" });
  }
  return cacheReport(clusterId, report);
};
