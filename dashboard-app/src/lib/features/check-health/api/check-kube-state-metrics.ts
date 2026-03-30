import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { DeploymentItem } from "$shared/model/clusters";
import { checkResponseStatus } from "$shared/lib/parsers";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";

const SERVICE = "kube-state-metrics";
const KUBE_STATE_METRICS_FEATURE_ID = "kube-state-metrics";

type KubeStateMetricsCheckResult = {
  error?: string;
  installed?: boolean;
  managedBy?: "helm" | "kubectl";
  namespace?: string;
  releaseName?: string;
  lastSync: string;
  status: Array<{ result: number }>;
  title: "Kube State Metrics";
  url?: string;
};

export const checkKubeStateMetrics = async (
  clusterId: string,
): Promise<KubeStateMetricsCheckResult> => {
  const results = [];
  let json;
  const skippedCapability = getFeatureCapability(clusterId, KUBE_STATE_METRICS_FEATURE_ID);

  if (
    shouldSkipFeatureProbe(clusterId, KUBE_STATE_METRICS_FEATURE_ID, {
      statuses: [
        "unsupported",
        "forbidden",
        "unreachable",
        "unavailable",
        "misconfigured",
        "unknown",
      ],
    })
  ) {
    const reason = skippedCapability?.reason ?? "kube-state-metrics probe temporarily paused.";
    return {
      error: reason,
      lastSync: new Date().toISOString(),
      status: [{ result: checkResponseStatus(reason) }],
      title: "Kube State Metrics",
    };
  }

  const [raw, podsRaw] = await Promise.all([
    kubectlRawFront("get deployment -A -o json", {
      clusterId,
    }),
    kubectlRawFront("get pod -A -o json", {
      clusterId,
    }),
  ]);

  if (podsRaw.errors.length) {
    return {
      error: podsRaw.errors,
      lastSync: new Date().toISOString(),
      status: [{ result: checkResponseStatus(podsRaw.errors) }],
      title: "Kube State Metrics",
    };
  }

  if (raw.errors.length) {
    return {
      error: raw.errors,
      lastSync: new Date().toISOString(),
      status: [{ result: checkResponseStatus(raw.errors) }],
      title: "Kube State Metrics",
    };
  }

  try {
    json = JSON.parse(raw.output) as {
      kind: "DeploymentList";
      items: DeploymentItem[];
    };
  } catch (e) {
    return {
      error: (e as Error).message || "Unknown error",
      lastSync: new Date().toISOString(),
      status: [{ result: -1 }],
      title: "Kube State Metrics",
    };
  }

  const deployments = Array.isArray(json.items) ? json.items : [];
  const targetService = deployments.find((s) => {
    const name = s.metadata.name.toLowerCase();
    const labelName = s.metadata.labels?.["app.kubernetes.io/name"]?.toLowerCase() ?? "";
    const appLabel = s.metadata.labels?.["app"]?.toLowerCase() ?? "";
    return (
      labelName === SERVICE || appLabel === SERVICE || name === SERVICE || name.includes(SERVICE)
    );
  });

  if (!targetService) {
    return {
      error: "Cluster has no kube-state-metrics deployment",
      installed: false,
      lastSync: new Date().toISOString(),
      status: [{ result: -1 }],
      title: "Kube State Metrics",
    };
  }

  const replicas = targetService.status.replicas;
  const readyReplicas = targetService.status.readyReplicas;
  const availableReplicas = targetService.status.availableReplicas;
  const deploymentReady =
    replicas > 0 && readyReplicas >= replicas && availableReplicas >= replicas;
  let readyPods = 0;
  let matchingPods = 0;
  try {
    const podsJson = JSON.parse(podsRaw.output) as {
      items?: Array<{
        metadata?: {
          name?: string;
          namespace?: string;
          labels?: Record<string, string>;
        };
        status?: {
          phase?: string;
          conditions?: Array<{ type?: string; status?: string }>;
          containerStatuses?: Array<{ ready?: boolean }>;
        };
      }>;
    };
    const namespace = targetService.metadata.namespace;
    const items = Array.isArray(podsJson.items) ? podsJson.items : [];
    const related = items.filter((pod) => {
      if (pod.metadata?.namespace !== namespace) return false;
      const name = (pod.metadata?.name ?? "").toLowerCase();
      const labels = pod.metadata?.labels ?? {};
      const appName = (labels["app.kubernetes.io/name"] ?? "").toLowerCase();
      const app = (labels["app"] ?? "").toLowerCase();
      return appName === SERVICE || app === SERVICE || name === SERVICE || name.includes(SERVICE);
    });
    matchingPods = related.length;
    readyPods = related.filter((pod) => {
      const phaseRunning = (pod.status?.phase ?? "").toLowerCase() === "running";
      const readyCondition =
        pod.status?.conditions?.some(
          (condition) => condition.type === "Ready" && condition.status === "True",
        ) ?? false;
      const containersReady =
        (pod.status?.containerStatuses?.length ?? 0) > 0 &&
        (pod.status?.containerStatuses?.every((container) => container.ready === true) ?? false);
      return phaseRunning && (readyCondition || containersReady);
    }).length;
  } catch (e) {
    return {
      error: (e as Error).message || "Unknown error",
      lastSync: new Date().toISOString(),
      status: [{ result: -1 }],
      title: "Kube State Metrics",
    };
  }

  const metricsUrl = `/api/v1/namespaces/${targetService.metadata.namespace}/services/${targetService.metadata.name}:8080/proxy/metrics`;
  const healthUrl = `/api/v1/namespaces/${targetService.metadata.namespace}/services/${targetService.metadata.name}:8080/proxy/healthz`;
  const endpointProbe = await kubectlRawFront(`get --raw ${healthUrl}`, { clusterId });
  if (endpointProbe.errors.length) {
    markFeatureCapabilityFromReason(clusterId, KUBE_STATE_METRICS_FEATURE_ID, endpointProbe.errors);
    return {
      error: endpointProbe.errors,
      installed: true,
      managedBy:
        targetService.metadata.labels?.["app.kubernetes.io/managed-by"]?.toLowerCase() === "helm"
          ? "helm"
          : "kubectl",
      namespace: targetService.metadata.namespace,
      releaseName: targetService.metadata.labels?.["app.kubernetes.io/instance"],
      lastSync: new Date().toISOString(),
      status: [{ result: checkResponseStatus(endpointProbe.errors) }],
      title: "Kube State Metrics",
      url: metricsUrl,
    };
  }

  const probeOutput = endpointProbe.output.trim().toLowerCase();
  const endpointReady = probeOutput === "ok" || probeOutput.startsWith("ok");
  if (endpointReady) {
    markFeatureCapability(clusterId, KUBE_STATE_METRICS_FEATURE_ID, {
      status: "available",
    });
  } else {
    markFeatureCapabilityFromReason(
      clusterId,
      KUBE_STATE_METRICS_FEATURE_ID,
      "kube-state-metrics healthz endpoint returned unhealthy status",
    );
  }

  if (deploymentReady && matchingPods > 0 && readyPods === matchingPods && endpointReady) {
    results.push({ result: 1 });
  } else {
    results.push({ result: 0 });
  }

  const managedByLabel = targetService.metadata.labels?.["app.kubernetes.io/managed-by"];
  const managedBy: "helm" | "kubectl" =
    managedByLabel?.toLowerCase() === "helm" ? "helm" : "kubectl";
  const releaseName = targetService.metadata.labels?.["app.kubernetes.io/instance"];

  const error = !deploymentReady
    ? "kube-state-metrics deployment is not Ready"
    : matchingPods === 0
      ? "kube-state-metrics pod not found"
      : readyPods === 0
        ? "kube-state-metrics pod is not Ready"
        : !endpointReady
          ? "kube-state-metrics healthz endpoint returned unhealthy status"
          : undefined;

  return {
    installed: true,
    managedBy,
    namespace: targetService.metadata.namespace,
    releaseName,
    ...(error ? { error } : {}),
    lastSync: new Date().toISOString(),
    status: results,
    title: "Kube State Metrics",
    url: metricsUrl,
  };
};
