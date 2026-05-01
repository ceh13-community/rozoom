import { getAllPods } from "$shared/api/tauri";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { DaemonSets, PodItem } from "$shared/model/clusters";
import { error } from "@tauri-apps/plugin-log";
import { findPrometheusNodeExporter } from "$entities/cluster";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MONITORING_NAMESPACE = "monitoring";
const METRICS_INDICATORS = ["# HELP", "# TYPE"] as const;

interface NodeStatus {
  nodeName: string;
  result: number;
}

interface NodeExporterResult {
  installed?: boolean;
  managedBy?: "helm" | "kubectl";
  namespace?: string;
  releaseName?: string;
  lastSync: string;
  status: NodeStatus[];
  title: string;
  url?: string;
  errors?: string[];
}

const hasMetrics = (output: string): boolean => {
  return METRICS_INDICATORS.some((indicator) => output.includes(indicator));
};

const isPodReady = (pod: Partial<PodItem>): boolean => {
  const status = pod.status as
    | {
        phase?: string;
        conditions?: Array<{ type?: string; status?: string }>;
        containerStatuses?: Array<{ ready?: boolean }>;
      }
    | undefined;

  const phase = (status?.phase || "").toLowerCase();
  if (phase !== "running") return false;

  const conditions = Array.isArray(status?.conditions) ? status.conditions : [];
  const readyCondition = conditions.some(
    (condition) => condition.type === "Ready" && condition.status === "True",
  );

  const containerStatuses = Array.isArray(status?.containerStatuses)
    ? status.containerStatuses
    : [];
  const containersReady =
    containerStatuses.length > 0 &&
    containerStatuses.every((container) => Boolean(container.ready));
  return readyCondition || containersReady;
};

const createTimestamp = (): string => new Date().toISOString();

const createNodeStatus = (nodeName: string, success: boolean): NodeStatus => ({
  nodeName,
  result: success ? 1 : -1,
});

const createNodeStatusByResult = (nodeName: string, result: number): NodeStatus => ({
  nodeName,
  result,
});

const ensurePods = (pods: PodItem[] | undefined): PodItem[] => {
  return Array.isArray(pods) ? pods : [];
};

const parseManagedBy = (
  labels: Record<string, string> | undefined,
): { managedBy?: "helm" | "kubectl"; releaseName?: string } => {
  if (!labels) return {};
  const managedByLabel = labels["app.kubernetes.io/managed-by"] ?? "";
  const managedBy: "helm" | "kubectl" =
    managedByLabel.toLowerCase() === "helm" ? "helm" : "kubectl";
  return {
    managedBy,
    releaseName: labels["app.kubernetes.io/instance"],
  };
};

const checkPodMetrics = async (pod: PodItem, clusterId: string): Promise<NodeStatus> => {
  const podName = pod.metadata.name;
  const namespace = pod.metadata.namespace || "default";
  if (!isPodReady(pod)) {
    return createNodeStatusByResult(pod.spec.nodeName || podName, 0);
  }
  // node-exporter does not expose /healthz in most versions, so probe /metrics
  // directly to avoid noisy "NotFound" errors in logs.
  const metricsUrl = `/api/v1/namespaces/${namespace}/pods/${podName}/proxy/metrics`;

  try {
    const metricsProbe = await kubectlRawFront(`get --raw ${metricsUrl}`, { clusterId });
    if (metricsProbe.errors.length > 0) {
      return createNodeStatusByResult(pod.spec.nodeName || podName, 0);
    }
    const success = hasMetrics(metricsProbe.output);
    return createNodeStatusByResult(pod.spec.nodeName || podName, success ? 1 : 0);
  } catch {
    return createNodeStatusByResult(pod.spec.nodeName || podName, 0);
  }
};

// 1. Check across all namespaces by pod labels (per-node results)
const checkByPodLabels = async (
  pods: PodItem[],
  clusterId: string,
): Promise<NodeExporterResult | null> => {
  const exporterPods = pods.filter(
    (pod) =>
      pod.metadata.labels &&
      Object.values(pod.metadata.labels).some(
        (value) => value.includes("node-exporter") || value.includes("prometheus-node-exporter"),
      ),
  );

  if (exporterPods.length === 0) return null;

  const statuses = await Promise.all(exporterPods.map((pod) => checkPodMetrics(pod, clusterId)));
  const metadata = parseManagedBy(exporterPods[0].metadata.labels);

  return {
    installed: true,
    ...metadata,
    namespace: exporterPods[0].metadata.namespace,
    lastSync: createTimestamp(),
    status: statuses,
    title: "Node Exporter",
  };
};

// 3. Check via DaemonSet (kube-prometheus-stack or other)
const checkViaDaemonSetPods = async (clusterId: string): Promise<NodeExporterResult | null> => {
  const daemonSetPods: PodItem[] = await findPrometheusNodeExporter(clusterId);

  if (daemonSetPods.length === 0) return null;

  const statuses = await Promise.all(daemonSetPods.map((pod) => checkPodMetrics(pod, clusterId)));
  const metadata = parseManagedBy(daemonSetPods[0].metadata.labels);

  return {
    installed: true,
    ...metadata,
    namespace: daemonSetPods[0].metadata.namespace,
    lastSync: createTimestamp(),
    status: statuses,
    title: "Node Exporter",
  };
};

// 2. Check via kube-prometheus-stack
const checkKubePrometheusStack = async (clusterId: string): Promise<NodeExporterResult | null> => {
  try {
    const response = await kubectlRawFront(
      "get daemonset -A -l app.kubernetes.io/name=prometheus-node-exporter -o json",
      { clusterId },
    );
    const daemonsets = JSON.parse(response.output) as DaemonSets;

    if (response.errors.length > 0 || !daemonsets.items.length) {
      return {
        installed: false,
        lastSync: createTimestamp(),
        status: [{ nodeName: "node-exporter", result: -1 }],
        title: "Node Exporter",
      };
    }

    const ready = daemonsets.items[0].status.numberReady;
    const desiredRaw = daemonsets.items[0].status.desiredNumberScheduled;
    const desired = Number.isFinite(desiredRaw) && desiredRaw > 0 ? desiredRaw : ready;
    const statusResult = ready > 0 && desired > 0 && ready === desired ? 1 : 0;

    return {
      installed: true,
      ...parseManagedBy(daemonsets.items[0].metadata.labels),
      namespace: daemonsets.items[0].metadata.namespace,
      lastSync: createTimestamp(),
      status: [createNodeStatus(daemonsets.items[0].metadata.name, statusResult === 1)],
      ...(statusResult === 0 ? { errors: ["node-exporter daemonset is not fully Ready"] } : {}),
      title: "Node Exporter",
    };
  } catch (err) {
    await error(`Error checking kube-prometheus-stack: ${err}`);
    return null;
  }
};

export const checkNodeExporter = async (clusterId: string): Promise<NodeExporterResult> => {
  const defaultEmptyResult = (): NodeExporterResult => ({
    installed: false,
    lastSync: createTimestamp(),
    status: [{ nodeName: "Unknown", result: -1 }],
    title: "Node Exporter",
  });

  try {
    const pods = ensurePods(await getAllPods(clusterId));

    // 1. Per-node check via pod labels across all namespaces (most accurate)
    const podLabelResult = await checkByPodLabels(pods, clusterId);
    if (podLabelResult && podLabelResult.status.length > 0) {
      return podLabelResult;
    }

    // 2. Per-node check via DaemonSet owner reference matching
    const daemonSetResult = await checkViaDaemonSetPods(clusterId);
    if (daemonSetResult && daemonSetResult.status.length > 0) {
      return daemonSetResult;
    }

    // 3. DaemonSet-level fallback (no per-node detail)
    const kubePrometheusResult = await checkKubePrometheusStack(clusterId);
    if (kubePrometheusResult && kubePrometheusResult.status.length > 0) {
      return kubePrometheusResult;
    }

    return defaultEmptyResult();
  } catch (err) {
    await error(`Critical error in checkNodeExporter: ${err}`);
    return {
      ...defaultEmptyResult(),
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
};
