import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, PriorityClassItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  PriorityHealthItem,
  PriorityHealthReport,
  PriorityHealthStatus,
  PriorityHealthSummary,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: PriorityHealthReport; fetchedAt: number }>();

const CRITICAL_LABEL_KEYS = [
  "kubemaster.io/critical",
  "kubemaster.io/production",
  "app.kubernetes.io/critical",
  "app.kubernetes.io/production",
];

const HIGH_PRIORITY_THRESHOLD = 100000;
const INFLATION_RATIO = 0.8;

type WorkloadDescriptor = {
  namespace: string;
  name: string;
  type: "Deployment" | "StatefulSet" | "DaemonSet";
  labels?: Record<string, string>;
  priorityClassName?: string;
};

type PriorityClassDescriptor = {
  name: string;
  value: number;
  preemptionPolicy?: string;
  globalDefault?: boolean;
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): PriorityHealthStatus {
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

function hasCriticalLabel(labels: Record<string, string> | undefined): boolean {
  if (!labels) return false;
  return CRITICAL_LABEL_KEYS.some((key) => {
    const value = labels[key];
    return value ? value.toLowerCase() === "true" : false;
  });
}

function extractWorkloads(data: ClusterData): WorkloadDescriptor[] {
  const workloads: WorkloadDescriptor[] = [];

  data.deployments.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "Deployment",
      labels: item.metadata.labels,
      priorityClassName: item.spec.template.spec.priorityClassName,
    });
  });

  data.statefulsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "StatefulSet",
      labels: item.metadata.labels,
      priorityClassName: item.spec.template.spec.priorityClassName,
    });
  });

  data.daemonsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "DaemonSet",
      labels: item.metadata.labels,
      priorityClassName: item.spec.template.spec.priorityClassName,
    });
  });

  return workloads;
}

function buildPriorityClassMap(items: PriorityClassItem[]): Map<string, PriorityClassDescriptor> {
  const map = new Map<string, PriorityClassDescriptor>();
  items.forEach((item) => {
    map.set(item.metadata.name, {
      name: item.metadata.name,
      value: item.value,
      preemptionPolicy: item.preemptionPolicy,
      globalDefault: item.globalDefault,
    });
  });
  return map;
}

function buildSummary(
  items: PriorityHealthItem[],
  errorStatus?: PriorityHealthStatus,
  priorityInflation?: boolean,
): PriorityHealthSummary {
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

  let status: PriorityHealthStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0 || priorityInflation) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = priorityInflation ? "Warning (priority inflation)" : `Warning (${totals.warning})`;
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

function buildRecommendation(template: "critical" | "nonpreempting" | "default"): string {
  if (template === "critical") {
    return 'apiVersion: scheduling.k8s.io/v1\nkind: PriorityClass\nmetadata:\n  name: critical-high\nvalue: 100000\npreemptionPolicy: PreemptLowerPriority\nglobalDefault: false\ndescription: "Critical-path services"';
  }
  if (template === "nonpreempting") {
    return 'apiVersion: scheduling.k8s.io/v1\nkind: PriorityClass\nmetadata:\n  name: high-nonpreempting\nvalue: 90000\npreemptionPolicy: Never\nglobalDefault: false\ndescription: "High priority without preemption"';
  }
  return "globalDefault: true\nvalue: 0";
}

function evaluateWorkload(
  workload: WorkloadDescriptor,
  priorityClasses: Map<string, PriorityClassDescriptor>,
): PriorityHealthItem {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const isCritical = hasCriticalLabel(workload.labels);
  const isStateful = workload.type === "StatefulSet";

  const priorityClassName = workload.priorityClassName;
  const priorityClass = priorityClassName ? priorityClasses.get(priorityClassName) : undefined;

  if (isCritical && !priorityClassName) {
    issues.push("Critical workload missing priorityClassName.");
    recommendations.push(buildRecommendation("critical"));
  }

  if (priorityClassName && !priorityClass) {
    issues.push("priorityClassName references a missing PriorityClass.");
  }

  if (priorityClass) {
    const preemptionPolicy = priorityClass.preemptionPolicy ?? "PreemptLowerPriority";
    if (isStateful && preemptionPolicy === "PreemptLowerPriority") {
      issues.push("Stateful workload uses PreemptLowerPriority preemption.");
      recommendations.push(buildRecommendation("nonpreempting"));
    }

    if (!isCritical && priorityClass.value >= HIGH_PRIORITY_THRESHOLD) {
      issues.push("High priority used on a non-critical workload.");
      recommendations.push(buildRecommendation("default"));
    }
  }

  let status: PriorityHealthStatus = "ok";
  if (issues.some((issue) => issue.toLowerCase().includes("critical workload"))) {
    status = "critical";
  } else if (issues.length > 0) {
    status = "warning";
  }

  return {
    namespace: workload.namespace,
    workload: workload.name,
    workloadType: workload.type,
    priorityClassName: priorityClassName ?? "-",
    priorityValue: priorityClass?.value,
    preemptionPolicy: priorityClass?.preemptionPolicy ?? "-",
    status,
    issues,
    recommendations,
  };
}

function applyPriorityInflation(
  items: PriorityHealthItem[],
  priorityClasses: Map<string, PriorityClassDescriptor>,
): boolean {
  if (items.length < 3) return false;
  const workloadItems = items.filter((item) => item.workloadType !== "PriorityClass");
  if (workloadItems.length < 3) return false;

  const usage = new Map<string, number>();
  workloadItems.forEach((item) => {
    if (!item.priorityClassName || item.priorityClassName === "-") return;
    usage.set(item.priorityClassName, (usage.get(item.priorityClassName) ?? 0) + 1);
  });

  let inflationDetected = false;
  usage.forEach((count, name) => {
    const ratio = count / workloadItems.length;
    const value = priorityClasses.get(name)?.value ?? 0;
    if (ratio >= INFLATION_RATIO && value > 0) {
      inflationDetected = true;
      workloadItems.forEach((item) => {
        if (item.priorityClassName === name) {
          item.issues.push("Priority inflation: most workloads use the same priority class.");
          if (item.status === "ok") item.status = "warning";
        }
      });
    }
  });

  return inflationDetected;
}

function buildUnusedPriorityItems(
  items: PriorityClassDescriptor[],
  usedNames: Set<string>,
): PriorityHealthItem[] {
  return items
    .filter((priorityClass) => !usedNames.has(priorityClass.name))
    .map((priorityClass) => ({
      namespace: "cluster",
      workload: priorityClass.name,
      workloadType: "PriorityClass",
      priorityClassName: priorityClass.name,
      priorityValue: priorityClass.value,
      preemptionPolicy: priorityClass.preemptionPolicy ?? "-",
      status: "warning",
      issues: ["PriorityClass is not referenced by any workload."],
      recommendations: [],
    }));
}

export async function checkPriorityStatus(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<PriorityHealthReport> {
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
        "deployments",
        "statefulsets",
        "daemonsets",
        "priorityclasses",
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load workload data.";
      await logError(`Priority check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load workload data.";
    await logError(`Priority check failed: ${errorMessage}`);
    data = null;
  }

  const items: PriorityHealthItem[] = [];
  let priorityInflation = false;

  if (data) {
    const workloads = extractWorkloads(data);
    const priorityClasses = buildPriorityClassMap(data.priorityclasses.items);

    workloads.forEach((workload) => {
      items.push(evaluateWorkload(workload, priorityClasses));
    });

    const usedNames = new Set(
      items
        .filter((item) => item.priorityClassName && item.priorityClassName !== "-")
        .map((item) => item.priorityClassName),
    );
    items.push(...buildUnusedPriorityItems(Array.from(priorityClasses.values()), usedNames));

    priorityInflation = applyPriorityInflation(items, priorityClasses);
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus, priorityInflation);

  const report: PriorityHealthReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
