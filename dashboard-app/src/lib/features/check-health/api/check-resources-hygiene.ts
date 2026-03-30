import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  ResourcesHygieneItem,
  ResourcesHygieneReport,
  ResourcesHygieneStatus,
  ResourcesHygieneSummary,
  ResourcesHygieneWorkload,
  ResourcesQosClass,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: ResourcesHygieneReport; fetchedAt: number }>();

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

type WorkloadDescriptor = {
  namespace: string;
  name: string;
  type: string;
  containers: ContainerSpec[];
};

type WorkloadEvaluation = {
  workload: ResourcesHygieneWorkload;
  items: ResourcesHygieneItem[];
};

const REQUIRED_LABELS = {
  cpuRequest: "cpu request",
  memoryRequest: "memory request",
  memoryLimit: "memory limit",
};

const OPTIONAL_LABELS = {
  cpuLimit: "cpu limit (optional)",
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function getContainersSummary(containers: ContainerSpec[]) {
  const summarized = containers.map((container) => {
    const resources = container.resources;
    const cpuRequest = resources?.requests?.cpu;
    const memoryRequest = resources?.requests?.memory;
    const cpuLimit = resources?.limits?.cpu;
    const memoryLimit = resources?.limits?.memory;

    return {
      name: container.name ?? "unknown",
      cpuRequest,
      memoryRequest,
      cpuLimit,
      memoryLimit,
    };
  });

  const hasAnyRequests = summarized.some(
    (container) => container.cpuRequest || container.memoryRequest,
  );
  const isBestEffort =
    summarized.length > 0 &&
    summarized.every(
      (container) =>
        !container.cpuRequest &&
        !container.memoryRequest &&
        !container.cpuLimit &&
        !container.memoryLimit,
    );

  const allGuaranteed =
    summarized.length > 0 &&
    summarized.every(
      (container) =>
        container.cpuRequest &&
        container.memoryRequest &&
        container.cpuLimit &&
        container.memoryLimit &&
        container.cpuRequest === container.cpuLimit &&
        container.memoryRequest === container.memoryLimit,
    );

  let qosClass: ResourcesQosClass = "Unknown";
  if (summarized.length === 0) {
    qosClass = "Unknown";
  } else if (isBestEffort) {
    qosClass = "BestEffort";
  } else if (allGuaranteed) {
    qosClass = "Guaranteed";
  } else {
    qosClass = "Burstable";
  }

  return {
    summarized,
    hasAnyRequests,
    qosClass,
  };
}

function evaluateWorkload(workload: WorkloadDescriptor): WorkloadEvaluation {
  const { summarized, hasAnyRequests, qosClass } = getContainersSummary(workload.containers);
  const missingRequired = new Set<string>();
  const missingOptional = new Set<string>();
  const items: ResourcesHygieneItem[] = [];

  if (summarized.length === 0) {
    missingRequired.add("containers missing");
    items.push({
      namespace: workload.namespace,
      workload: workload.name,
      workloadType: workload.type,
      container: "-",
      missing: ["containers missing"],
      optionalMissing: [],
      qosClass,
    });
  }

  summarized.forEach((container) => {
    const missing: string[] = [];
    const optionalMissing: string[] = [];

    if (!container.cpuRequest) missing.push(REQUIRED_LABELS.cpuRequest);
    if (!container.memoryRequest) missing.push(REQUIRED_LABELS.memoryRequest);
    if (!container.memoryLimit) missing.push(REQUIRED_LABELS.memoryLimit);
    if (!container.cpuLimit) optionalMissing.push(OPTIONAL_LABELS.cpuLimit);

    missing.forEach((value) => missingRequired.add(value));
    optionalMissing.forEach((value) => missingOptional.add(value));

    if (missing.length > 0 || optionalMissing.length > 0) {
      items.push({
        namespace: workload.namespace,
        workload: workload.name,
        workloadType: workload.type,
        container: container.name,
        missing,
        optionalMissing,
        qosClass,
      });
    }
  });

  const isBestEffort = qosClass === "BestEffort";
  const hasMissingRequired = missingRequired.size > 0;

  let status: ResourcesHygieneStatus = "ok";
  if (!hasAnyRequests || isBestEffort) {
    status = "critical";
  } else if (hasMissingRequired) {
    status = "warning";
  }

  if (summarized.length === 0) {
    status = "warning";
  }

  const workloadSummary: ResourcesHygieneWorkload = {
    namespace: workload.namespace,
    workload: workload.name,
    workloadType: workload.type,
    status,
    qosClass,
    missing: Array.from(missingRequired),
    optionalMissing: Array.from(missingOptional),
  };

  return { workload: workloadSummary, items };
}

function buildSummary(
  workloads: ResourcesHygieneWorkload[],
  errorStatus?: ResourcesHygieneStatus,
): ResourcesHygieneSummary {
  const totals = workloads.reduce(
    (acc, workload) => {
      acc.total += 1;
      if (workload.status === "ok") acc.ok += 1;
      if (workload.status === "warning") acc.warning += 1;
      if (workload.status === "critical") acc.critical += 1;
      if (workload.qosClass === "BestEffort") acc.bestEffort += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0, bestEffort: 0 },
  );

  let status: ResourcesHygieneStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = `${totals.warning} warning${totals.warning === 1 ? "" : "s"}`;
  } else if (status === "critical") {
    if (totals.bestEffort > 0) {
      message = `Critical (${totals.bestEffort} BestEffort workload${
        totals.bestEffort === 1 ? "" : "s"
      })`;
    } else {
      message = `Critical (${totals.critical} workload${totals.critical === 1 ? "" : "s"})`;
    }
  } else if (status === "unreachable") {
    message = "Unreachable";
  } else if (status === "insufficient") {
    message = "Insufficient permissions";
  } else if (status === "unknown") {
    message = "Unknown";
  }

  return {
    status,
    message,
    ...totals,
    updatedAt: Date.now(),
  };
}

function resolveErrorStatus(message?: string): ResourcesHygieneStatus {
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
      containers: item.spec.template.spec.containers,
    });
  });

  data.statefulsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "StatefulSet",
      containers: item.spec.template.spec.containers,
    });
  });

  data.daemonsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "DaemonSet",
      containers: item.spec.template.spec.containers,
    });
  });

  data.jobs.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "Job",
      containers: item.spec.template?.spec?.containers ?? [],
    });
  });

  data.cronjobs.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "CronJob",
      containers: item.spec.jobTemplate?.spec?.template?.spec?.containers ?? [],
    });
  });

  return workloads;
}

export async function checkResourcesHygiene(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<ResourcesHygieneReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let workloads: WorkloadDescriptor[] = [];

  try {
    const data =
      options?.data ??
      (await loadClusterEntities({ uuid: clusterId }, [
        "deployments",
        "statefulsets",
        "daemonsets",
        "jobs",
        "cronjobs",
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load workloads for resource hygiene.";
      await logError(`Resources hygiene check failed: ${errorMessage}`);
    } else {
      workloads = extractWorkloads(data);
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to load workloads for resource hygiene.";
    await logError(`Resources hygiene check failed: ${errorMessage}`);
  }

  const evaluations = workloads.map((workload) => evaluateWorkload(workload));
  const workloadSummaries = evaluations.map((evaluation) => evaluation.workload);
  const items = evaluations.flatMap((evaluation) => evaluation.items);

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(workloadSummaries, errorStatus);
  const report: ResourcesHygieneReport = {
    status: summary.status,
    summary,
    workloads: workloadSummaries,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
