import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, ContainerProbe } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  ProbeSummary,
  ProbesHealthItem,
  ProbesHealthReport,
  ProbesHealthStatus,
  ProbesHealthSummary,
  ProbesHealthWorkload,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: ProbesHealthReport; fetchedAt: number }>();

const AGGRESSIVE_TIMEOUT_SECONDS = 1;
const AGGRESSIVE_PERIOD_SECONDS = 5;
const AGGRESSIVE_FAILURE_THRESHOLD = 2;
const STARTUP_RECOMMENDED_DELAY = 30;
const EARLY_LIVENESS_DELAY = 5;

type ContainerSpec = {
  name?: string;
  readinessProbe?: ContainerProbe;
  livenessProbe?: ContainerProbe;
  startupProbe?: ContainerProbe;
};

type WorkloadDescriptor = {
  namespace: string;
  name: string;
  type: string;
  containers: ContainerSpec[];
};

type WorkloadEvaluation = {
  workload: ProbesHealthWorkload;
  items: ProbesHealthItem[];
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): ProbesHealthStatus {
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

function getProbeType(probe?: ContainerProbe): ProbeSummary["type"] {
  if (!probe) return "missing";
  if (probe.httpGet) return "httpGet";
  if (probe.tcpSocket) return "tcpSocket";
  if (probe.exec) return "exec";
  return "unknown";
}

function summarizeProbe(probe?: ContainerProbe): ProbeSummary {
  return {
    type: getProbeType(probe),
    initialDelaySeconds: probe?.initialDelaySeconds,
    timeoutSeconds: probe?.timeoutSeconds,
    periodSeconds: probe?.periodSeconds,
    failureThreshold: probe?.failureThreshold,
    successThreshold: probe?.successThreshold,
  };
}

function isSameProbe(a?: ContainerProbe, b?: ContainerProbe): boolean {
  if (!a || !b) return false;
  const typeA = getProbeType(a);
  const typeB = getProbeType(b);
  if (typeA !== typeB) return false;

  const fieldsMatch =
    a.initialDelaySeconds === b.initialDelaySeconds &&
    a.timeoutSeconds === b.timeoutSeconds &&
    a.periodSeconds === b.periodSeconds &&
    a.failureThreshold === b.failureThreshold &&
    a.successThreshold === b.successThreshold;

  if (!fieldsMatch) return false;

  if (typeA === "httpGet") {
    return (
      a.httpGet?.path === b.httpGet?.path &&
      a.httpGet?.port === b.httpGet?.port &&
      a.httpGet?.scheme === b.httpGet?.scheme
    );
  }
  if (typeA === "tcpSocket") {
    return a.tcpSocket?.port === b.tcpSocket?.port;
  }
  if (typeA === "exec") {
    const commandA = a.exec?.command ?? [];
    const commandB = b.exec?.command ?? [];
    return (
      commandA.length === commandB.length && commandA.every((value, idx) => value === commandB[idx])
    );
  }
  return false;
}

function hasAggressiveTiming(probe?: ContainerProbe): boolean {
  if (!probe) return false;
  return (
    (probe.timeoutSeconds !== undefined && probe.timeoutSeconds < AGGRESSIVE_TIMEOUT_SECONDS) ||
    (probe.periodSeconds !== undefined && probe.periodSeconds <= AGGRESSIVE_PERIOD_SECONDS) ||
    (probe.failureThreshold !== undefined && probe.failureThreshold < AGGRESSIVE_FAILURE_THRESHOLD)
  );
}

function isDangerousLiveness(probe?: ContainerProbe): boolean {
  if (!probe) return false;
  const timeout = probe.timeoutSeconds ?? AGGRESSIVE_TIMEOUT_SECONDS;
  const failure = probe.failureThreshold ?? 1;
  return timeout <= AGGRESSIVE_TIMEOUT_SECONDS && failure <= 1;
}

function isStartupRecommended(readiness?: ContainerProbe, liveness?: ContainerProbe): boolean {
  const readinessDelay = readiness?.initialDelaySeconds ?? 0;
  const livenessDelay = liveness?.initialDelaySeconds ?? 0;
  return Math.max(readinessDelay, livenessDelay) >= STARTUP_RECOMMENDED_DELAY;
}

function buildSummary(
  workloads: ProbesHealthWorkload[],
  errorStatus?: ProbesHealthStatus,
): ProbesHealthSummary {
  const totals = workloads.reduce(
    (acc, workload) => {
      acc.total += 1;
      if (workload.status === "ok") acc.ok += 1;
      if (workload.status === "warning") acc.warning += 1;
      if (workload.status === "critical") acc.critical += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 },
  );

  let status: ProbesHealthStatus = "ok";
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

  return workloads;
}

function evaluateContainer(
  workload: WorkloadDescriptor,
  container: ContainerSpec,
): ProbesHealthItem {
  const criticalIssues: string[] = [];
  const warningIssues: string[] = [];
  const hints: string[] = [];

  const readiness = summarizeProbe(container.readinessProbe);
  const liveness = summarizeProbe(container.livenessProbe);
  const startup = summarizeProbe(container.startupProbe);

  const hasReadiness = readiness.type !== "missing";
  const hasLiveness = liveness.type !== "missing";
  const hasStartup = startup.type !== "missing";
  const hasAnyProbe = hasReadiness || hasLiveness || hasStartup;

  if (!hasAnyProbe) {
    criticalIssues.push("Missing all probes");
    hints.push("Add readiness/liveness probes to protect rollouts and traffic routing.");
  }

  if (!hasReadiness) {
    criticalIssues.push("Missing readinessProbe");
    hints.push("Add readinessProbe to avoid routing traffic to unready pods.");
  }

  if (!hasLiveness) {
    warningIssues.push("Missing livenessProbe");
    hints.push("Add livenessProbe to auto-recover from deadlocks.");
  }

  if (
    hasReadiness &&
    hasLiveness &&
    isSameProbe(container.readinessProbe, container.livenessProbe)
  ) {
    warningIssues.push("readinessProbe matches livenessProbe");
    hints.push("Use distinct readiness and liveness probes for accurate traffic gating.");
  }

  if (!hasStartup && isStartupRecommended(container.readinessProbe, container.livenessProbe)) {
    warningIssues.push("Missing startupProbe for slow start");
    hints.push("Add startupProbe when startup latency is high to prevent premature restarts.");
  }

  if (!hasStartup && (container.livenessProbe?.initialDelaySeconds ?? 0) <= EARLY_LIVENESS_DELAY) {
    warningIssues.push("livenessProbe starts too early");
    hints.push("Increase livenessProbe initialDelaySeconds or add startupProbe.");
  }

  if (isDangerousLiveness(container.livenessProbe)) {
    criticalIssues.push("livenessProbe is too aggressive");
    hints.push("Relax livenessProbe timeoutSeconds/failureThreshold to avoid crash loops.");
  }

  if (hasAggressiveTiming(container.readinessProbe)) {
    warningIssues.push("readinessProbe has aggressive timing");
    hints.push("Increase timeoutSeconds/periodSeconds/failureThreshold to avoid flapping.");
  }

  if (hasAggressiveTiming(container.livenessProbe)) {
    warningIssues.push("livenessProbe has aggressive timing");
    hints.push("Increase timeoutSeconds/periodSeconds/failureThreshold to avoid restarts.");
  }

  if (hasAggressiveTiming(container.startupProbe)) {
    warningIssues.push("startupProbe has aggressive timing");
    hints.push("Relax startupProbe timings to allow slow initialization.");
  }

  const issues = [...criticalIssues, ...warningIssues];
  const status: ProbesHealthStatus =
    criticalIssues.length > 0 ? "critical" : warningIssues.length > 0 ? "warning" : "ok";

  return {
    namespace: workload.namespace,
    workload: workload.name,
    workloadType: workload.type,
    container: container.name ?? "unknown",
    status,
    issues,
    hints,
    readiness,
    liveness,
    startup,
  };
}

function evaluateWorkload(workload: WorkloadDescriptor): WorkloadEvaluation | null {
  if (!Array.isArray(workload.containers)) {
    void logError(
      `Probes check skipped workload ${workload.namespace}/${workload.name}: containers not found.`,
    );
    return null;
  }

  if (workload.containers.length === 0) {
    const item: ProbesHealthItem = {
      namespace: workload.namespace,
      workload: workload.name,
      workloadType: workload.type,
      container: "-",
      status: "warning",
      issues: ["No containers defined"],
      hints: ["Ensure workload templates define at least one container."],
      readiness: { type: "missing" },
      liveness: { type: "missing" },
      startup: { type: "missing" },
    };
    return {
      workload: {
        namespace: workload.namespace,
        workload: workload.name,
        workloadType: workload.type,
        status: "warning",
        issues: item.issues,
      },
      items: [item],
    };
  }

  const items = workload.containers.map((container) => evaluateContainer(workload, container));
  const status = items.some((item) => item.status === "critical")
    ? "critical"
    : items.some((item) => item.status === "warning")
      ? "warning"
      : "ok";

  const issues = Array.from(new Set(items.flatMap((item) => item.issues)));

  return {
    workload: {
      namespace: workload.namespace,
      workload: workload.name,
      workloadType: workload.type,
      status,
      issues,
    },
    items,
  };
}

export async function checkProbesHealth(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<ProbesHealthReport> {
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
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load cluster workloads.";
      await logError(`Probes check failed: ${errorMessage}`);
    } else {
      workloads = extractWorkloads(data);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load cluster workloads.";
    await logError(`Probes check failed: ${errorMessage}`);
  }

  const items: ProbesHealthItem[] = [];
  const workloadSummaries: ProbesHealthWorkload[] = [];

  workloads.forEach((workload) => {
    const evaluation = evaluateWorkload(workload);
    if (!evaluation) return;
    workloadSummaries.push(evaluation.workload);
    items.push(...evaluation.items);
  });

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(workloadSummaries, errorStatus);

  const report: ProbesHealthReport = {
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
