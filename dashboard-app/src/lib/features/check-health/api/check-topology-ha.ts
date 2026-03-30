import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, PodItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  TopologyHaItem,
  TopologyHaReport,
  TopologyHaStatus,
  TopologyHaSummary,
  TopologySpreadStrategy,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: TopologyHaReport; fetchedAt: number }>();
const ZONE_LABEL_KEYS = ["topology.kubernetes.io/zone", "failure-domain.beta.kubernetes.io/zone"];

type WorkloadDescriptor = {
  namespace: string;
  name: string;
  type: "Deployment" | "StatefulSet";
  replicas: number;
  selector: Record<string, string>;
  podSpec: {
    topologySpreadConstraints?: {
      maxSkew?: number;
      topologyKey?: string;
      whenUnsatisfiable?: string;
    }[];
    affinity?: {
      podAntiAffinity?: {
        requiredDuringSchedulingIgnoredDuringExecution?: unknown[];
        preferredDuringSchedulingIgnoredDuringExecution?: unknown[];
      };
    };
  };
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): TopologyHaStatus {
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

function extractWorkloads(data: ClusterData): WorkloadDescriptor[] {
  const workloads: WorkloadDescriptor[] = [];

  data.deployments.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "Deployment",
      replicas: item.spec.replicas,
      selector: item.spec.selector.matchLabels,
      podSpec: item.spec.template.spec,
    });
  });

  data.statefulsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "StatefulSet",
      replicas: item.spec.replicas,
      selector: item.spec.selector.matchLabels,
      podSpec: item.spec.template.spec,
    });
  });

  return workloads;
}

function matchLabels(labels: Record<string, string> | undefined, selector: Record<string, string>) {
  if (!labels) return false;
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function findPodZone(pod: PodItem, nodeZones: Map<string, string | null>): string | null {
  const nodeName = pod.spec.nodeName;
  if (!nodeName) return null;
  return nodeZones.get(nodeName) ?? null;
}

function resolveZoneLabel(nodeLabels: Record<string, string> | undefined): string | null {
  if (!nodeLabels) return null;
  for (const key of ZONE_LABEL_KEYS) {
    if (nodeLabels[key]) return nodeLabels[key];
  }
  return null;
}

function summarizeStrategy(workload: WorkloadDescriptor): TopologySpreadStrategy {
  const constraints = workload.podSpec.topologySpreadConstraints ?? [];
  const podAntiAffinity = workload.podSpec.affinity?.podAntiAffinity;

  const topologyKeys = constraints
    .map((constraint) => constraint.topologyKey)
    .filter((key): key is string => Boolean(key));
  const whenUnsatisfiable = constraints
    .map((constraint) => constraint.whenUnsatisfiable)
    .filter((value): value is string => Boolean(value));
  const maxSkews = constraints
    .map((constraint) => constraint.maxSkew)
    .filter((value): value is number => typeof value === "number");

  return {
    hasTopologySpreadConstraints: constraints.length > 0,
    hasRequiredAntiAffinity:
      (podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.length ?? 0) > 0,
    hasPreferredAntiAffinity:
      (podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution?.length ?? 0) > 0,
    topologyKeys,
    whenUnsatisfiable,
    maxSkews,
  };
}

function buildSummary(items: TopologyHaItem[], errorStatus?: TopologyHaStatus): TopologyHaSummary {
  const totals = items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ok") acc.ok += 1;
      if (item.status === "warning") acc.warning += 1;
      if (item.status === "critical") acc.critical += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 },
  );

  let status: TopologyHaStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = `Warning (${totals.warning})`;
  } else if (status === "critical") {
    message = `Critical (${totals.critical})`;
  } else if (status === "unreachable") {
    message = "Unreachable";
  } else if (status === "insufficient") {
    message = "Insufficient permissions";
  } else if (status === "unknown") {
    message = "Unknown";
  }

  return { status, message, ...totals, updatedAt: Date.now() };
}

function buildRecommendations(strategy: TopologySpreadStrategy): string[] {
  const recommendations = [];
  if (!strategy.hasTopologySpreadConstraints && !strategy.hasRequiredAntiAffinity) {
    recommendations.push(
      "topologySpreadConstraints:\\n  - maxSkew: 1\\n    topologyKey: topology.kubernetes.io/zone\\n    whenUnsatisfiable: DoNotSchedule\\n    labelSelector:\\n      matchLabels:\\n        app: my-app",
    );
    recommendations.push(
      "affinity:\\n  podAntiAffinity:\\n    requiredDuringSchedulingIgnoredDuringExecution:\\n      - labelSelector:\\n          matchLabels:\\n            app: my-app\\n        topologyKey: kubernetes.io/hostname",
    );
  }
  return recommendations;
}

function evaluateWorkload(
  workload: WorkloadDescriptor,
  pods: PodItem[],
  clusterZones: Set<string>,
  nodeZones: Map<string, string | null>,
): TopologyHaItem {
  const strategy = summarizeStrategy(workload);
  const issues: string[] = [];
  const hints: string[] = [];
  const recommendations = buildRecommendations(strategy);

  if (workload.replicas < 2) {
    return {
      namespace: workload.namespace,
      workload: workload.name,
      workloadType: workload.type,
      replicas: workload.replicas,
      status: "ok",
      issues: [],
      hints: ["Replicas < 2; HA spread is not required."],
      strategy,
      placement: {
        nodes: [],
        zones: [],
      },
      recommendations,
    };
  }

  if (!strategy.hasTopologySpreadConstraints && !strategy.hasRequiredAntiAffinity) {
    issues.push("No topology spread constraints or required anti-affinity configured.");
  }

  if (strategy.hasPreferredAntiAffinity && !strategy.hasRequiredAntiAffinity) {
    issues.push("podAntiAffinity is preferred-only.");
  }

  if (strategy.whenUnsatisfiable.includes("ScheduleAnyway")) {
    issues.push("topologySpreadConstraints uses ScheduleAnyway.");
  }

  if (
    strategy.topologyKeys.length > 0 &&
    !strategy.topologyKeys.includes("topology.kubernetes.io/zone")
  ) {
    issues.push("topologySpreadConstraints do not include zone spread.");
  }

  const matchingPods = pods.filter(
    (pod) =>
      normalizeNamespace(pod.metadata.namespace) === workload.namespace &&
      matchLabels(pod.metadata.labels, workload.selector),
  );

  const nodeSet = new Set<string>();
  const zoneSet = new Set<string>();

  matchingPods.forEach((pod) => {
    if (pod.spec.nodeName) {
      nodeSet.add(pod.spec.nodeName);
    }
    const zone = findPodZone(pod, nodeZones);
    if (zone) zoneSet.add(zone);
  });

  if (matchingPods.length > 0 && nodeSet.size <= 1) {
    issues.push("All replicas scheduled on a single node.");
  }

  if (clusterZones.size > 1 && zoneSet.size <= 1) {
    issues.push("All replicas scheduled in a single zone.");
  }

  if (nodeZones.size === 0) {
    hints.push("Node metadata unavailable; zone-level spread not evaluated.");
  } else if (clusterZones.size === 0) {
    hints.push("Zone labels missing; zone-level spread not evaluated.");
  }

  let status: TopologyHaStatus = "ok";
  const hasCriticalIssue = issues.some((issue) =>
    ["single node", "single zone", "no topology spread"].some((keyword) =>
      issue.toLowerCase().includes(keyword),
    ),
  );

  if (hasCriticalIssue) {
    status = "critical";
  } else if (issues.length > 0) {
    status = "warning";
  }

  return {
    namespace: workload.namespace,
    workload: workload.name,
    workloadType: workload.type,
    replicas: workload.replicas,
    status,
    issues,
    hints,
    strategy,
    placement: {
      nodes: Array.from(nodeSet),
      zones: Array.from(zoneSet),
    },
    recommendations,
  };
}

export async function checkTopologyHa(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<TopologyHaReport> {
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
        "nodes",
        "deployments",
        "statefulsets",
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load workload data.";
      await logError(`Topology HA check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load workload data.";
    await logError(`Topology HA check failed: ${errorMessage}`);
    data = null;
  }

  const items: TopologyHaItem[] = [];

  if (data) {
    const nodeZones = new Map<string, string | null>();
    data.nodes.items.forEach((node) => {
      nodeZones.set(node.metadata.name, resolveZoneLabel(node.metadata.labels));
    });
    const clusterZones = new Set(
      Array.from(nodeZones.values()).filter((value): value is string => Boolean(value)),
    );

    const workloads = extractWorkloads(data);
    workloads.forEach((workload) => {
      items.push(evaluateWorkload(workload, data.pods.items, clusterZones, nodeZones));
    });
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus);

  const report: TopologyHaReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
