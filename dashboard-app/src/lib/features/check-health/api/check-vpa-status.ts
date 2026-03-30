import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { isExpectedClusterProbeError } from "$shared/lib/runtime-probe-errors";
import type { ClusterData } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import {
  getFeatureCapability,
  markFeatureCapability,
  markFeatureCapabilityFromReason,
  shouldSkipFeatureProbe,
} from "../model/feature-capability-cache";
import type {
  VpaHealthItem,
  VpaHealthReport,
  VpaHealthStatus,
  VpaHealthSummary,
  VpaRecommendationRange,
  VpaUpdateMode,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT = "10s";
const cachedReports = new Map<string, { data: VpaHealthReport; fetchedAt: number }>();

async function logVpaErrorIfUnexpected(message: string) {
  if (isExpectedClusterProbeError(message)) return;
  await logError(`VPA check failed: ${message}`);
}
const VPA_FEATURE_ID = "resource:verticalpodautoscalers";

type RawHpa = {
  metadata?: {
    namespace?: string;
  };
  spec?: {
    scaleTargetRef?: { kind?: string; name?: string };
  };
};

type RawHpaList = {
  items?: RawHpa[];
};

type RawVpaRecommendation = {
  lowerBound?: { cpu?: string; memory?: string };
  target?: { cpu?: string; memory?: string };
  upperBound?: { cpu?: string; memory?: string };
};

type RawVpaContainerRecommendation = {
  containerName?: string;
  lowerBound?: { cpu?: string; memory?: string };
  target?: { cpu?: string; memory?: string };
  upperBound?: { cpu?: string; memory?: string };
};

type RawVpa = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    targetRef?: { kind?: string; name?: string };
    updatePolicy?: { updateMode?: string };
  };
  status?: {
    recommendation?: {
      containerRecommendations?: RawVpaContainerRecommendation[];
    };
    conditions?: { type?: string; status?: string; reason?: string; message?: string }[];
  };
};

type RawVpaList = {
  items?: RawVpa[];
};

type WorkloadTarget = {
  key: string;
  namespace: string;
  name: string;
  type: "Deployment" | "StatefulSet";
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function buildWorkloadKey(namespace: string, type: string, name: string): string {
  return `${namespace}:${type}:${name}`;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveErrorStatus(message?: string): VpaHealthStatus {
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

function extractWorkloads(data: ClusterData): WorkloadTarget[] {
  const workloads: WorkloadTarget[] = [];

  data.deployments.items.forEach((item) => {
    const namespace = normalizeNamespace(item.metadata.namespace);
    workloads.push({
      key: buildWorkloadKey(namespace, "Deployment", item.metadata.name),
      namespace,
      name: item.metadata.name,
      type: "Deployment",
    });
  });

  data.statefulsets.items.forEach((item) => {
    const namespace = normalizeNamespace(item.metadata.namespace);
    workloads.push({
      key: buildWorkloadKey(namespace, "StatefulSet", item.metadata.name),
      namespace,
      name: item.metadata.name,
      type: "StatefulSet",
    });
  });

  return workloads;
}

function resolveUpdateMode(raw?: string): VpaUpdateMode {
  if (!raw) return "Unknown";
  if (raw === "Off") return "Off";
  if (raw === "Initial") return "Initial";
  if (raw === "Recommend") return "Recommend";
  if (raw === "Auto") return "Auto";
  return "Unknown";
}

function hasRecommendations(vpa: RawVpa): boolean {
  const recommendations = vpa.status?.recommendation?.containerRecommendations ?? [];
  return recommendations.length > 0;
}

function extractRecommendation(vpa: RawVpa): VpaRecommendationRange | null {
  const recommendations = vpa.status?.recommendation?.containerRecommendations ?? [];
  if (!recommendations.length) return null;

  const aggregate = recommendations.reduce<RawVpaRecommendation>((acc, current) => {
    acc.lowerBound = acc.lowerBound ?? current.lowerBound;
    acc.target = acc.target ?? current.target;
    acc.upperBound = acc.upperBound ?? current.upperBound;
    return acc;
  }, {});

  return {
    min: aggregate.lowerBound,
    target: aggregate.target,
    max: aggregate.upperBound,
  };
}

function buildSummary(items: VpaHealthItem[], errorStatus?: VpaHealthStatus): VpaHealthSummary {
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

  let status: VpaHealthStatus = "ok";
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

function isVpaNotInstalled(message?: string): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("no matches for kind") ||
    normalized.includes("the server doesn't have a resource type") ||
    normalized.includes("not found")
  );
}

export async function checkVpaStatus(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<VpaHealthReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  if (
    !options?.force &&
    shouldSkipFeatureProbe(clusterId, VPA_FEATURE_ID, {
      statuses: ["unsupported", "forbidden"],
    })
  ) {
    const capability = getFeatureCapability(clusterId, VPA_FEATURE_ID);
    const errorMessage = capability?.reason ?? "VPA not installed in this cluster.";
    const status = capability?.status === "forbidden" ? "insufficient" : "warning";
    const report: VpaHealthReport = {
      status,
      summary: buildSummary([], status),
      items: [],
      errors: errorMessage,
      updatedAt: Date.now(),
    };
    cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
    return report;
  }

  let errorMessage: string | undefined;
  let vpaItems: RawVpa[] = [];
  let hpaItems: RawHpa[] = [];
  let workloads: WorkloadTarget[] = [];

  try {
    const data =
      options?.data ??
      (await loadClusterEntities({ uuid: clusterId }, ["deployments", "statefulsets"]));
    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load cluster workloads.";
      await logVpaErrorIfUnexpected(errorMessage);
    } else {
      workloads = extractWorkloads(data);
    }

    const vpaResult = await kubectlRawFront(
      `get verticalpodautoscalers --all-namespaces -o json --request-timeout=${REQUEST_TIMEOUT}`,
      { clusterId },
    );

    if (vpaResult.errors || vpaResult.code !== 0) {
      errorMessage = vpaResult.errors || "Failed to fetch VPA resources.";
      markFeatureCapabilityFromReason(clusterId, VPA_FEATURE_ID, errorMessage);
      await logVpaErrorIfUnexpected(errorMessage);
    } else {
      const parsed = parseJson(vpaResult.output) as RawVpaList | null;
      vpaItems = parsed?.items ?? [];
      markFeatureCapability(clusterId, VPA_FEATURE_ID, { status: "available" });
    }

    const hpaResult = await kubectlRawFront(
      `get hpa --all-namespaces -o json --request-timeout=${REQUEST_TIMEOUT}`,
      { clusterId },
    );

    if (!hpaResult.errors && hpaResult.code === 0) {
      const parsed = parseJson(hpaResult.output) as RawHpaList | null;
      hpaItems = parsed?.items ?? [];
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch VPA resources.";
    markFeatureCapabilityFromReason(clusterId, VPA_FEATURE_ID, errorMessage);
    await logVpaErrorIfUnexpected(errorMessage);
  }

  const workloadMap = new Map<string, WorkloadTarget>(
    workloads.map((workload) => [workload.key, workload]),
  );
  const hpaTargets = new Set<string>();
  hpaItems.forEach((hpa) => {
    const namespace = normalizeNamespace(hpa.metadata?.namespace);
    const target = hpa.spec?.scaleTargetRef;
    if (!target || !target.kind || !target.name) return;
    hpaTargets.add(buildWorkloadKey(namespace, target.kind, target.name));
  });

  const items: VpaHealthItem[] = [];

  vpaItems.forEach((vpa) => {
    const namespace = normalizeNamespace(vpa.metadata?.namespace);
    const vpaName = vpa.metadata?.name ?? "unknown";
    const target = vpa.spec?.targetRef;
    const workloadType = target?.kind ?? "Unknown";
    const workloadName = target?.name ?? "unknown";
    const workloadKey = buildWorkloadKey(namespace, workloadType, workloadName);
    const updateMode = resolveUpdateMode(vpa.spec?.updatePolicy?.updateMode);
    const hasHpa = hpaTargets.has(workloadKey);
    const hasWorkload = workloadMap.has(workloadKey);
    const recommendation = extractRecommendation(vpa);
    const issues: string[] = [];

    let status: VpaHealthStatus = "ok";

    if (!hasWorkload) {
      status = "critical";
      issues.push("Scale target workload not found.");
    }

    if (updateMode === "Auto" && hasHpa) {
      status = "critical";
      issues.push("VPA Auto conflicts with HPA.");
    } else if (updateMode === "Off" || updateMode === "Initial") {
      status = status === "critical" ? status : "warning";
      issues.push(`VPA updateMode is ${updateMode}.`);
    } else if (updateMode === "Unknown") {
      status = status === "critical" ? status : "warning";
      issues.push("VPA updateMode is unknown.");
    }

    if (!hasRecommendations(vpa)) {
      status = status === "critical" ? status : "warning";
      issues.push("Recommendations not available yet.");
    }

    items.push({
      namespace,
      workload: workloadName,
      workloadType,
      vpaName,
      updateMode,
      hpaPresent: hasHpa,
      status,
      issues,
      recommendation,
    });
  });

  let errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  if (errorMessage && isVpaNotInstalled(errorMessage)) {
    errorMessage = "VPA not installed in this cluster.";
    errorStatus = "warning";
  }

  const summary = buildSummary(items, errorStatus);
  const report: VpaHealthReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
