import { error as logError } from "@tauri-apps/plugin-log";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { ClusterData, MetaData } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  HpaCheckItem,
  HpaCheckReport,
  HpaCheckStatus,
  HpaCheckSummary,
  HpaMetricType,
  HpaMetricUsage,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const REQUEST_TIMEOUT = "10s";
const AUTOSCALE_REQUIRED_KEYS = [
  "autoscaling.kubemaster.io/required",
  "kubemaster.io/autoscale-required",
];

const cachedReports = new Map<string, { data: HpaCheckReport; fetchedAt: number }>();

type RawHpaMetric = {
  type?: string;
  resource?: {
    name?: string;
    target?: { type?: string; averageUtilization?: number; averageValue?: string; value?: string };
  };
  pods?: { metric?: { name?: string } };
  object?: { metric?: { name?: string } };
  external?: { metric?: { name?: string } };
};

type RawHpaCondition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
};

type RawHpa = {
  metadata?: MetaData;
  spec?: {
    minReplicas?: number;
    maxReplicas?: number;
    scaleTargetRef?: { kind?: string; name?: string };
    metrics?: RawHpaMetric[];
  };
  status?: {
    currentReplicas?: number;
    desiredReplicas?: number;
    conditions?: RawHpaCondition[];
  };
};

type RawHpaList = {
  items?: RawHpa[];
};

type WorkloadTarget = {
  key: string;
  name: string;
  namespace: string;
  type: "Deployment" | "StatefulSet";
  required: boolean;
};

function parseJson(raw: string): RawHpaList | null {
  try {
    return JSON.parse(raw) as RawHpaList;
  } catch {
    return null;
  }
}

function buildWorkloadKey(namespace: string, type: string, name: string): string {
  return `${namespace}:${type}:${name}`;
}

function isRequiredAutoscale(metadata?: MetaData): boolean {
  if (!metadata) return false;
  const labels = metadata.labels ?? {};
  const annotations =
    (metadata as MetaData & { annotations?: Record<string, string> }).annotations ?? {};

  return AUTOSCALE_REQUIRED_KEYS.some((key) => {
    const labelValue = labels[key];
    const annotationValue = annotations[key];
    return (
      (labelValue && labelValue.toLowerCase() === "true") ||
      (annotationValue && annotationValue.toLowerCase() === "true")
    );
  });
}

function extractWorkloads(data: ClusterData): WorkloadTarget[] {
  const workloads: WorkloadTarget[] = [];

  data.deployments.items.forEach((item) => {
    const namespace = item.metadata.namespace ?? "default";
    workloads.push({
      key: buildWorkloadKey(namespace, "Deployment", item.metadata.name),
      name: item.metadata.name,
      namespace,
      type: "Deployment",
      required: isRequiredAutoscale(item.metadata),
    });
  });

  data.statefulsets.items.forEach((item) => {
    const namespace = item.metadata.namespace ?? "default";
    workloads.push({
      key: buildWorkloadKey(namespace, "StatefulSet", item.metadata.name),
      name: item.metadata.name,
      namespace,
      type: "StatefulSet",
      required: isRequiredAutoscale(item.metadata),
    });
  });

  return workloads;
}

function resolveMetricTypes(metrics?: RawHpaMetric[]): HpaMetricUsage {
  if (!metrics || metrics.length === 0) {
    return { types: ["unknown"], labels: ["unknown"] };
  }

  const types = new Set<HpaMetricType>();
  const labels: string[] = [];

  for (const metric of metrics) {
    const metricType = metric.type?.toLowerCase();
    if (metricType === "resource") {
      const name = metric.resource?.name?.toLowerCase();
      if (name === "cpu") {
        types.add("cpu");
        labels.push("cpu");
      } else if (name === "memory") {
        types.add("memory");
        labels.push("memory");
      } else {
        types.add("custom");
        labels.push(name ?? "resource");
      }
    } else if (metricType === "pods") {
      types.add("custom");
      labels.push(metric.pods?.metric?.name ?? "pods");
    } else if (metricType === "object") {
      types.add("custom");
      labels.push(metric.object?.metric?.name ?? "object");
    } else if (metricType === "external") {
      types.add("external");
      labels.push(metric.external?.metric?.name ?? "external");
    } else {
      types.add("unknown");
      labels.push(metric.type ?? "unknown");
    }
  }

  return {
    types: Array.from(types),
    labels,
  };
}

function getCondition(
  conditions: RawHpaCondition[] | undefined,
  type: string,
): RawHpaCondition | null {
  return conditions?.find((condition) => condition.type === type) ?? null;
}

function resolveErrorStatus(message?: string): HpaCheckStatus {
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

function buildSummary(items: HpaCheckItem[], errorStatus?: HpaCheckStatus): HpaCheckSummary {
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

  let status: HpaCheckStatus = "ok";
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

function hasResourceMetrics(types: HpaMetricType[]): boolean {
  return types.includes("cpu") || types.includes("memory");
}

function isScalingActive(conditions: RawHpaCondition[] | undefined): boolean | null {
  const active = getCondition(conditions, "ScalingActive");
  if (!active || !active.status) return null;
  return active.status === "True";
}

function isMetricsAvailable(conditions: RawHpaCondition[] | undefined): boolean | null {
  const ableToScale = getCondition(conditions, "AbleToScale");
  if (!ableToScale || !ableToScale.status) return null;
  return ableToScale.status === "True";
}

function isScalingHealthy(current?: number, desired?: number): boolean | null {
  if (current === undefined || desired === undefined) return null;
  return Math.abs(current - desired) <= 1;
}

function buildItem(params: {
  namespace: string;
  workload: string;
  workloadType: string;
  hpaName: string;
  minReplicas?: number;
  maxReplicas?: number;
  currentReplicas?: number;
  desiredReplicas?: number;
  metrics: HpaMetricUsage;
  status: HpaCheckStatus;
  reason?: string;
  message?: string;
  scalingActive?: boolean | null;
}): HpaCheckItem {
  return {
    namespace: params.namespace,
    workload: params.workload,
    workloadType: params.workloadType,
    hpaName: params.hpaName,
    minReplicas: params.minReplicas,
    maxReplicas: params.maxReplicas,
    currentReplicas: params.currentReplicas,
    desiredReplicas: params.desiredReplicas,
    metrics: params.metrics,
    status: params.status,
    reason: params.reason,
    message: params.message,
    scalingActive: params.scalingActive ?? null,
  };
}

export async function checkHpaStatus(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData; metricsServerAvailable?: boolean },
): Promise<HpaCheckReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let hpas: RawHpa[] = [];
  let workloads: WorkloadTarget[] = [];

  try {
    const data =
      options?.data ??
      (await loadClusterEntities({ uuid: clusterId }, ["deployments", "statefulsets"]));
    workloads = extractWorkloads(data);

    const result = await kubectlRawFront(
      `get hpa --all-namespaces -o json --request-timeout=${REQUEST_TIMEOUT}`,
      { clusterId },
    );

    if (result.errors || result.code !== 0) {
      errorMessage = result.errors || "Failed to fetch HPA resources.";
      await logError(`HPA check failed: ${errorMessage}`);
    } else {
      const parsed = parseJson(result.output);
      hpas = parsed?.items ?? [];
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to fetch HPA resources.";
    await logError(`HPA check failed: ${errorMessage}`);
  }

  const metricsServerAvailable = options?.metricsServerAvailable ?? true;
  const workloadMap = new Map<string, WorkloadTarget>(
    workloads.map((workload) => [workload.key, workload]),
  );
  const items: HpaCheckItem[] = [];
  const matchedWorkloads = new Set<string>();

  hpas.forEach((hpa) => {
    const namespace = hpa.metadata?.namespace ?? "default";
    const hpaName = hpa.metadata?.name ?? "unknown";
    const target = hpa.spec?.scaleTargetRef;
    const workloadType = target?.kind ?? "Unknown";
    const workloadName = target?.name ?? "unknown";
    const workloadKey = buildWorkloadKey(namespace, workloadType, workloadName);
    const workloadExists = workloadMap.has(workloadKey);
    if (workloadExists) {
      matchedWorkloads.add(workloadKey);
    }

    const metricsUsage = resolveMetricTypes(hpa.spec?.metrics);
    const conditions = hpa.status?.conditions ?? [];
    const scalingActive = isScalingActive(conditions);
    const metricsOk = isMetricsAvailable(conditions);
    const scalingHealthy = isScalingHealthy(
      hpa.status?.currentReplicas,
      hpa.status?.desiredReplicas,
    );

    let status: HpaCheckStatus = "ok";
    let reason = "";
    let message = "";

    if (!workloadExists) {
      status = "critical";
      reason = "InvalidScaleTargetRef";
      message = "Scale target workload not found.";
    } else if (scalingActive === false) {
      status = "critical";
      reason = getCondition(conditions, "ScalingActive")?.reason ?? "ScalingInactive";
      message = getCondition(conditions, "ScalingActive")?.message ?? "Scaling is inactive.";
    } else if (
      conditions.some((condition) => condition.reason?.includes("FailedGetResourceMetric")) ||
      conditions.some((condition) => condition.reason?.includes("FailedGetExternalMetric")) ||
      conditions.some((condition) => condition.reason?.includes("FailedGetObjectMetric")) ||
      conditions.some((condition) => condition.reason?.includes("FailedGetPodsMetric"))
    ) {
      status = "critical";
      reason = "FailedGetMetric";
      message =
        conditions.find((condition) => condition.reason?.includes("FailedGet"))?.message ??
        "HPA failed to fetch metrics.";
    } else if (!metricsServerAvailable && hasResourceMetrics(metricsUsage.types)) {
      status = "critical";
      reason = "MetricsServerUnavailable";
      message = "Metrics server is unavailable for resource metrics.";
    } else if (metricsOk === false || scalingActive === null) {
      status = "warning";
      reason = getCondition(conditions, "AbleToScale")?.reason ?? "MetricsUnavailable";
      message =
        getCondition(conditions, "AbleToScale")?.message ?? "Metrics temporarily unavailable.";
    } else if (scalingHealthy === false) {
      status = "warning";
      reason = "ScalingMismatch";
      message = "Desired replicas differ from current.";
    }

    items.push(
      buildItem({
        namespace,
        workload: workloadName,
        workloadType,
        hpaName,
        minReplicas: hpa.spec?.minReplicas,
        maxReplicas: hpa.spec?.maxReplicas,
        currentReplicas: hpa.status?.currentReplicas,
        desiredReplicas: hpa.status?.desiredReplicas,
        metrics: metricsUsage,
        status,
        reason,
        message,
        scalingActive,
      }),
    );
  });

  workloads.forEach((workload) => {
    if (!workload.required || matchedWorkloads.has(workload.key)) return;
    items.push(
      buildItem({
        namespace: workload.namespace,
        workload: workload.name,
        workloadType: workload.type,
        hpaName: "-",
        minReplicas: undefined,
        maxReplicas: undefined,
        currentReplicas: undefined,
        desiredReplicas: undefined,
        metrics: { types: ["unknown"], labels: ["missing hpa"] },
        status: "critical",
        reason: "MissingHpa",
        message: "Autoscaling required but no HPA found.",
        scalingActive: null,
      }),
    );
  });

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus);

  const report: HpaCheckReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
