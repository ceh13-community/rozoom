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

/**
 * Discover every TCP port a node-exporter container claims and return the
 * likely metrics port first. 9100 is the default for the standalone chart
 * and for the node-exporter subchart in kube-prometheus-stack, but custom
 * installs and hardened variants (e.g. behind kube-rbac-proxy on 9091) do
 * vary, so we pull ports directly from the pod spec and add 9100 as a
 * conventional fallback.
 */
const nodeExporterProbePorts = (pod: PodItem): number[] => {
  const candidates: number[] = [];
  const containers = (
    pod.spec as { containers?: Array<{ ports?: Array<{ containerPort?: number }> }> }
  ).containers;
  for (const container of containers ?? []) {
    for (const port of container.ports ?? []) {
      if (typeof port.containerPort === "number" && port.containerPort > 0) {
        candidates.push(port.containerPort);
      }
    }
  }
  if (!candidates.includes(9100)) candidates.push(9100);
  // Dedupe while preserving priority (pod-declared ports first, 9100 last).
  return [...new Set(candidates)];
};

const checkPodMetrics = async (pod: PodItem, clusterId: string): Promise<NodeStatus> => {
  const podName = pod.metadata.name;
  const namespace = pod.metadata.namespace || "default";
  const nodeName = pod.spec.nodeName || podName;
  if (!isPodReady(pod)) {
    return createNodeStatusByResult(nodeName, 0);
  }
  // node-exporter does not expose /healthz in most versions, so probe /metrics
  // directly to avoid noisy "NotFound" errors in logs.
  //
  // We try every declared container port and the conventional 9100 as a
  // fallback. kube-prometheus-stack exposes the metrics on 9100 by default,
  // but hardened installs bind node-exporter behind kube-rbac-proxy on a
  // different port; the API server's pod-proxy without an explicit port
  // picks the first declared port, which may be that proxy (and refuse
  // unauthenticated traffic). Enumerating ports makes the probe work in
  // both topologies without guessing.
  const ports = nodeExporterProbePorts(pod);
  const basePath = `/api/v1/namespaces/${namespace}/pods/${podName}`;

  let lastProbeFailed = false;
  for (const port of ports) {
    const metricsUrl = `${basePath}:${port}/proxy/metrics`;
    try {
      const metricsProbe = await kubectlRawFront(`get --raw ${metricsUrl}`, { clusterId });
      if (metricsProbe.errors.length > 0) {
        lastProbeFailed = true;
        continue;
      }
      if (hasMetrics(metricsProbe.output)) {
        return createNodeStatusByResult(nodeName, 1);
      }
      lastProbeFailed = true;
    } catch {
      lastProbeFailed = true;
    }
  }

  // One last attempt without a port - lets the API server default to the
  // pod's first container port. Covers exotic pods that declare no port
  // explicitly but still serve metrics (rare but seen in custom builds).
  if (lastProbeFailed) {
    try {
      const fallback = await kubectlRawFront(`get --raw ${basePath}/proxy/metrics`, { clusterId });
      if (fallback.errors.length === 0 && hasMetrics(fallback.output)) {
        return createNodeStatusByResult(nodeName, 1);
      }
    } catch {
      // fall through to unreachable result below
    }
  }

  return createNodeStatusByResult(nodeName, 0);
};

/**
 * Probe the node-exporter Service (if one exists) via the K8s service proxy.
 *
 * On EKS (and other managed distros with restrictive CNI policies) the API
 * server cannot open a direct pod-proxy to host-network pods, which is
 * exactly how kube-prometheus-stack runs node-exporter by default. The
 * Service proxy goes through normal ClusterIP routing, which always works
 * as long as the headless / ClusterIP service is wired up and at least one
 * backend pod is ready.
 *
 * If the service responds with valid metrics once, we trust that every
 * Ready pod from the matching DaemonSet is serving metrics too, and avoid
 * N direct pod-proxy hits that would fail deterministically on EKS.
 */
const tryServiceProxy = async (
  pods: PodItem[],
  clusterId: string,
): Promise<NodeExporterResult | null> => {
  // Every API-server hop here is best-effort: a failure must yield null so
  // the caller can try pod-proxy next instead of dragging the whole check
  // into the outer catch-all error path.
  let svcResponse: Awaited<ReturnType<typeof kubectlRawFront>>;
  try {
    svcResponse = await kubectlRawFront(
      `get services -A -l app.kubernetes.io/name in (node-exporter,prometheus-node-exporter) -o json`,
      { clusterId },
    );
  } catch {
    return null;
  }
  if (svcResponse.errors.length > 0 || !svcResponse.output) return null;

  type SvcPort = { name?: string; port?: number };
  type SvcItem = {
    metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
    spec?: { ports?: SvcPort[] };
  };
  let parsed: { items?: SvcItem[] };
  try {
    parsed = JSON.parse(svcResponse.output) as { items?: SvcItem[] };
  } catch {
    return null;
  }
  const services = parsed.items ?? [];
  if (services.length === 0) return null;

  const service = services[0];
  const namespace = service.metadata?.namespace;
  const name = service.metadata?.name;
  if (!namespace || !name) return null;

  // Prefer a named "metrics" / "http-metrics" port, else first numeric port,
  // else fall back to conventional 9100.
  const ports = service.spec?.ports ?? [];
  const named = ports.find((p) => p.name === "metrics" || p.name === "http-metrics");
  const first = ports.find((p) => typeof p.port === "number" && p.port > 0);
  const targetPort = named?.port ?? first?.port ?? 9100;

  let probe: Awaited<ReturnType<typeof kubectlRawFront>>;
  try {
    probe = await kubectlRawFront(
      `get --raw /api/v1/namespaces/${namespace}/services/${name}:${targetPort}/proxy/metrics`,
      { clusterId },
    );
  } catch {
    return null;
  }
  if (probe.errors.length > 0 || !hasMetrics(probe.output)) return null;

  // Service answered. Derive per-node status from the DaemonSet pods matching
  // the exporter labels so the UI can still show "available on every node"
  // coverage. Pods we identified as Ready are trusted to be serving.
  const exporterPods = pods.filter(
    (pod) =>
      pod.metadata.labels &&
      Object.values(pod.metadata.labels).some(
        (value) => value.includes("node-exporter") || value.includes("prometheus-node-exporter"),
      ),
  );
  const statuses: NodeStatus[] = exporterPods.length
    ? exporterPods.map((pod) =>
        createNodeStatusByResult(pod.spec.nodeName || pod.metadata.name, isPodReady(pod) ? 1 : 0),
      )
    : [{ nodeName: name, result: 1 }];
  const metadata = parseManagedBy(service.metadata?.labels);

  return {
    installed: true,
    ...metadata,
    namespace,
    lastSync: createTimestamp(),
    status: statuses,
    title: "Node Exporter",
    url: `svc/${namespace}/${name}:${targetPort}`,
  };
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

    // 1. Service proxy - works in EKS/GKE/AKS where pod proxy to hostNetwork
    //    pods is blocked by the managed CNI. Fastest + most reliable path.
    const svcResult = await tryServiceProxy(pods, clusterId);
    if (svcResult && svcResult.status.length > 0) {
      return svcResult;
    }

    // 2. Per-node check via pod labels (most accurate when pod proxy works).
    const podLabelResult = await checkByPodLabels(pods, clusterId);
    if (podLabelResult && podLabelResult.status.length > 0) {
      return podLabelResult;
    }

    // 3. Per-node check via DaemonSet owner reference matching
    const daemonSetResult = await checkViaDaemonSetPods(clusterId);
    if (daemonSetResult && daemonSetResult.status.length > 0) {
      return daemonSetResult;
    }

    // 4. DaemonSet-level fallback (no per-node detail)
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
