import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, PodItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  PodQosClass,
  PodQosItem,
  PodQosReport,
  PodQosStatus,
  PodQosSummary,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: PodQosReport; fetchedAt: number }>();

const CRITICAL_LABEL_KEYS = [
  "kubemaster.io/critical",
  "kubemaster.io/production",
  "app.kubernetes.io/critical",
  "app.kubernetes.io/production",
];

const DISPOSABLE_LABEL_KEYS = [
  "kubemaster.io/disposable",
  "kubemaster.io/batch",
  "workload.kubernetes.io/type",
];

const DISPOSABLE_LABEL_VALUES = new Set(["batch", "disposable", "job"]);

type ResourceFields = {
  cpu?: string;
  memory?: string;
};

type ContainerResources = {
  requests?: ResourceFields;
  limits?: ResourceFields;
};

type ContainerSpec = {
  name?: string;
  resources?: ContainerResources;
};

type WorkloadInfo = {
  name: string;
  type: string;
  labels?: Record<string, string>;
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): PodQosStatus {
  if (!message) return "unknown";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("forbidden") ||
    normalized.includes("unauthorized") ||
    normalized.includes("permission")
  ) {
    return "insufficient";
  }
  if (
    normalized.includes("connection") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable") ||
    normalized.includes("refused")
  ) {
    return "unreachable";
  }
  return "unknown";
}

function computePodQos(containers: ContainerSpec[]): PodQosClass {
  if (containers.length === 0) return "Unknown";

  const summaries = containers.map((container) => {
    const resources = container.resources;
    return {
      cpuRequest: resources?.requests?.cpu,
      memoryRequest: resources?.requests?.memory,
      cpuLimit: resources?.limits?.cpu,
      memoryLimit: resources?.limits?.memory,
    };
  });

  const isBestEffort = summaries.every(
    (container) =>
      !container.cpuRequest &&
      !container.memoryRequest &&
      !container.cpuLimit &&
      !container.memoryLimit,
  );
  if (isBestEffort) return "BestEffort";

  const isGuaranteed = summaries.every(
    (container) =>
      container.cpuRequest &&
      container.memoryRequest &&
      container.cpuLimit &&
      container.memoryLimit &&
      container.cpuRequest === container.cpuLimit &&
      container.memoryRequest === container.memoryLimit,
  );
  if (isGuaranteed) return "Guaranteed";

  return "Burstable";
}

function hasCriticalLabel(labels: Record<string, string> | undefined): boolean {
  if (!labels) return false;
  return CRITICAL_LABEL_KEYS.some((key) => {
    const value = labels[key];
    return value ? value.toLowerCase() === "true" : false;
  });
}

function hasDisposableLabel(labels: Record<string, string> | undefined): boolean {
  if (!labels) return false;
  return DISPOSABLE_LABEL_KEYS.some((key) => {
    const value = labels[key];
    if (!value) return false;
    if (key === "workload.kubernetes.io/type") {
      return DISPOSABLE_LABEL_VALUES.has(value.toLowerCase());
    }
    return value.toLowerCase() === "true";
  });
}

function buildSummary(items: PodQosItem[], errorStatus?: PodQosStatus): PodQosSummary {
  const totals = items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ok") acc.ok += 1;
      if (item.status === "warning") acc.warning += 1;
      if (item.status === "critical") acc.critical += 1;
      if (item.qosClass === "BestEffort") acc.bestEffort += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0, bestEffort: 0 },
  );

  let status: PodQosStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = `Warning (${totals.bestEffort} BestEffort pod${totals.bestEffort === 1 ? "" : "s"})`;
  } else if (status === "critical") {
    message = `Critical (${totals.critical} BestEffort critical pod${totals.critical === 1 ? "" : "s"})`;
  } else if (status === "unreachable") {
    message = "Unreachable";
  } else if (status === "insufficient") {
    message = "Insufficient permissions";
  } else if (status === "unknown") {
    message = "Unknown";
  }

  return { status, message, ...totals, updatedAt: Date.now() };
}

function getWorkloadInfo(data: ClusterData, pod: PodItem): WorkloadInfo {
  const namespace = normalizeNamespace(pod.metadata.namespace);
  const owner = pod.metadata.ownerReferences?.[0];

  if (!owner) {
    return { name: pod.metadata.name, type: "Pod", labels: pod.metadata.labels };
  }

  if (owner.kind === "ReplicaSet") {
    const rs = data.replicasets.items.find(
      (item) => item.metadata.name === owner.name && item.metadata.namespace === namespace,
    );
    const deploymentRef = rs?.metadata.ownerReferences?.find((ref) => ref.kind === "Deployment");
    if (deploymentRef) {
      const deployment = data.deployments.items.find(
        (item) =>
          item.metadata.name === deploymentRef.name && item.metadata.namespace === namespace,
      );
      return {
        name: deployment?.metadata.name ?? owner.name,
        type: "Deployment",
        labels: deployment?.metadata.labels,
      };
    }

    return { name: owner.name, type: "ReplicaSet", labels: rs?.metadata.labels };
  }

  if (owner.kind === "StatefulSet") {
    const statefulSet = data.statefulsets.items.find(
      (item) => item.metadata.name === owner.name && item.metadata.namespace === namespace,
    );
    return {
      name: owner.name,
      type: "StatefulSet",
      labels: statefulSet?.metadata.labels,
    };
  }

  if (owner.kind === "DaemonSet") {
    const daemonSet = data.daemonsets.items.find(
      (item) => item.metadata.name === owner.name && item.metadata.namespace === namespace,
    );
    return {
      name: owner.name,
      type: "DaemonSet",
      labels: daemonSet?.metadata.labels,
    };
  }

  if (owner.kind === "Job") {
    return { name: owner.name, type: "Job", labels: pod.metadata.labels };
  }

  return { name: owner.name, type: owner.kind, labels: pod.metadata.labels };
}

function getMissingResources(containers: ContainerSpec[]): string[] {
  const missing = new Set<string>();

  containers.forEach((container) => {
    const resources = container.resources;
    if (!resources?.requests?.cpu) missing.add("cpu request");
    if (!resources?.requests?.memory) missing.add("memory request");
    if (!resources?.limits?.cpu) missing.add("cpu limit");
    if (!resources?.limits?.memory) missing.add("memory limit");
  });

  return Array.from(missing);
}

function getRecommendation(
  qosClass: PodQosClass,
  isCritical: boolean,
): {
  recommendedQos: PodQosClass;
  recommendation: string;
  sampleConfig: string;
} {
  if (qosClass === "BestEffort") {
    const recommendedQos = isCritical ? "Guaranteed" : "Burstable";
    return {
      recommendedQos,
      recommendation: isCritical
        ? "Set requests=limits to reach Guaranteed for critical workloads."
        : "Set requests to move from BestEffort to Burstable.",
      sampleConfig: isCritical
        ? 'resources:\n  requests:\n    cpu: "500m"\n    memory: "512Mi"\n  limits:\n    cpu: "500m"\n    memory: "512Mi"'
        : 'resources:\n  requests:\n    cpu: "100m"\n    memory: "128Mi"',
    };
  }

  if (qosClass === "Burstable") {
    return {
      recommendedQos: "Burstable",
      recommendation: "Keep Burstable for most workloads; use Guaranteed only when required.",
      sampleConfig:
        'resources:\n  requests:\n    cpu: "250m"\n    memory: "256Mi"\n  limits:\n    cpu: "500m"\n    memory: "512Mi"',
    };
  }

  if (qosClass === "Guaranteed") {
    return {
      recommendedQos: "Guaranteed",
      recommendation: "Use Guaranteed only for truly critical workloads.",
      sampleConfig:
        'resources:\n  requests:\n    cpu: "500m"\n    memory: "512Mi"\n  limits:\n    cpu: "500m"\n    memory: "512Mi"',
    };
  }

  return {
    recommendedQos: "Burstable",
    recommendation: "Define requests to avoid BestEffort scheduling.",
    sampleConfig: 'resources:\n  requests:\n    cpu: "100m"\n    memory: "128Mi"',
  };
}

export async function checkPodQos(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<PodQosReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let data: ClusterData | null = null;

  try {
    data =
      options?.data ??
      (await loadClusterEntities({ uuid: clusterId }, [
        "pods",
        "replicasets",
        "deployments",
        "statefulsets",
        "daemonsets",
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load pod data.";
      await logError(`Pod QoS check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load pod data.";
    await logError(`Pod QoS check failed: ${errorMessage}`);
    data = null;
  }

  const items: PodQosItem[] = [];

  if (data) {
    data.pods.items.forEach((pod) => {
      const qosClass =
        (pod.status.qosClass as PodQosClass | undefined) ?? computePodQos(pod.spec.containers);
      const workload = getWorkloadInfo(data, pod);
      const workloadLabels = workload.labels ?? {};
      const isCritical = hasCriticalLabel(workloadLabels) || hasCriticalLabel(pod.metadata.labels);
      const isDisposable =
        workload.type === "Job" ||
        hasDisposableLabel(workloadLabels) ||
        hasDisposableLabel(pod.metadata.labels) ||
        Boolean(pod.metadata.labels?.["job-name"]);
      const missing = getMissingResources(pod.spec.containers);
      const recommendation = getRecommendation(qosClass, isCritical);

      let status: PodQosStatus = "ok";
      if (qosClass === "BestEffort") {
        status = isCritical ? "critical" : "warning";
        if (isDisposable) {
          status = "warning";
        }
      } else if (qosClass === "Unknown") {
        status = "warning";
      }

      items.push({
        namespace: normalizeNamespace(pod.metadata.namespace),
        pod: pod.metadata.name,
        workload: workload.name,
        workloadType: workload.type,
        qosClass,
        status,
        missing,
        recommendedQos: recommendation.recommendedQos,
        recommendation: recommendation.recommendation,
        sampleConfig: recommendation.sampleConfig,
      });
    });
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus);

  const report: PodQosReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
