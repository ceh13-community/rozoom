import { timeAgo } from "$shared/lib/timeFormatters";
import { prepareNodesBadge } from "$entities/cluster";
import type { NamespaceData, Pods, Nodes, PodItem } from "$shared/model/clusters";
import type { ControlPlaneComponentPodReport, ControlPlaneComponentsReport } from "../model/types";

type StatusMode = "simple" | "detailed";
type MetricsResult = {
  result: number;
};

export function parseNamespaces(data?: NamespaceData) {
  if (!data) return [];

  return data.items.map((ns) => ns.metadata.name);
}

export function parsePodRestarts(data?: Pods) {
  if (!data) return [];

  const checks = data.items.map((pod) => {
    return {
      pod: pod.metadata.name,
      namespace: pod.metadata.namespace,
      containers:
        pod.status.containerStatuses?.map((container) => {
          const age = container.state.running
            ? timeAgo(new Date(container.state.running.startedAt))
            : "";
          return {
            containerName: container.name,
            lastState: container.lastState,
            namespace: pod.metadata.namespace,
            startedAt: age,
            state: container.state,
            ready: container.ready,
            restartCount: container.restartCount,
          };
        }) || [],
    };
  });

  return checks;
}

export function parseNodes(data?: Nodes) {
  if (!data) return null;

  try {
    const nodesChecks = data.items.map((node) => ({
      metadata: {
        name: node.metadata.name,
        creationTimestamp: node.metadata.creationTimestamp,
      },
      status: {
        conditions: node.status.conditions,
      },
      role: Object.keys(node.metadata.labels || {})
        .filter((k) => k.startsWith("node-role.kubernetes.io/"))
        .map((k) => k.slice("node-role.kubernetes.io/".length))
        .join(", "),
    }));

    return {
      checks: nodesChecks,
      summary: prepareNodesBadge(data.items),
    };
  } catch {
    return null;
  }
}

function summarizeControlPlanePods(pods: PodItem[]): ControlPlaneComponentPodReport | undefined {
  if (pods.length === 0) return undefined;

  const readyPods = pods.filter((pod) => {
    const statuses = pod.status.containerStatuses ?? [];
    return statuses.length > 0 && statuses.every((container) => container.ready);
  }).length;
  const totalRestarts = pods.reduce(
    (sum, pod) =>
      sum +
      (pod.status.containerStatuses ?? []).reduce(
        (containerSum, container) => containerSum + container.restartCount,
        0,
      ),
    0,
  );

  let status: ControlPlaneComponentPodReport["status"] = "critical";
  if (readyPods === pods.length) {
    status = "ok";
  } else if (readyPods > 0 || pods.some((pod) => pod.status.phase === "Running")) {
    status = "warning";
  }

  const podNames = pods.map((pod) => pod.metadata.name);
  const message =
    status === "ok"
      ? `Pod fallback: ${readyPods}/${pods.length} kube-system pod(s) ready.`
      : status === "warning"
        ? `Pod fallback: ${readyPods}/${pods.length} kube-system pod(s) ready; inspect control-plane pod readiness.`
        : "Pod fallback: no ready kube-system control-plane pods matched.";

  return {
    source: "pod",
    status,
    matchedPods: pods.length,
    readyPods,
    totalRestarts,
    podNames,
    message,
  };
}

export function parseControlPlaneComponents(data?: Pods): ControlPlaneComponentsReport | undefined {
  if (!data) return undefined;

  const kubeSystemPods = data.items.filter((pod) => pod.metadata.namespace === "kube-system");
  const schedulerPods = kubeSystemPods.filter((pod) =>
    pod.metadata.name.startsWith("kube-scheduler"),
  );
  const controllerManagerPods = kubeSystemPods.filter((pod) =>
    pod.metadata.name.startsWith("kube-controller-manager"),
  );

  const scheduler = summarizeControlPlanePods(schedulerPods);
  const controllerManager = summarizeControlPlanePods(controllerManagerPods);

  if (!scheduler && !controllerManager) return undefined;

  return {
    scheduler,
    controllerManager,
    updatedAt: Date.now(),
  };
}

export function parseMetricsServiceStatus(
  results: MetricsResult[],
  mode: StatusMode = "simple",
): string {
  if (results.length === 0 || results.some((r) => r.result === -1)) {
    return mode === "simple" ? "❌ Not found" : "0 🔴";
  }

  const stats = {
    failed: results.filter((r) => r.result === 0).length,
    timeout: results.some((r) => r.result === 2),
    success: results.filter((r) => r.result === 1).length,
  };

  if (stats.timeout) {
    return mode === "simple" ? "⏳ Timeout" : `-/${results.length} 🟠`;
  }

  if (stats.failed > 0) {
    return mode === "simple"
      ? "🟠 Installed but unreachable"
      : `${results.length - stats.failed}/${results.length} 🟠`;
  }

  return mode === "simple" ? "✅ Available" : `${results.length}/${results.length} 🟢`;
}
