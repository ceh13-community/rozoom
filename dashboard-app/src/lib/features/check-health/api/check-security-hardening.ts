import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  SecurityHardeningItem,
  SecurityHardeningReport,
  SecurityHardeningStatus,
  SecurityHardeningSummary,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: SecurityHardeningReport; fetchedAt: number }>();

const PSA_ENFORCE_LABEL = "pod-security.kubernetes.io/enforce";
const PSA_LEVELS = ["privileged", "baseline", "restricted"] as const;
type PsaLevel = (typeof PSA_LEVELS)[number];

type ContainerSpec = {
  name: string;
  securityContext?: {
    runAsNonRoot?: boolean;
    runAsUser?: number;
    allowPrivilegeEscalation?: boolean;
    readOnlyRootFilesystem?: boolean;
    privileged?: boolean;
    seccompProfile?: {
      type?: string;
    };
    capabilities?: {
      drop?: string[];
      add?: string[];
    };
  };
};

type PodSpecShape = {
  containers?: ContainerSpec[];
  securityContext?: {
    runAsNonRoot?: boolean;
    runAsUser?: number;
    seccompProfile?: {
      type?: string;
    };
  };
  hostNetwork?: boolean;
  hostPID?: boolean;
  hostIPC?: boolean;
};

type WorkloadDescriptor = {
  namespace: string;
  name: string;
  type: string;
  podSpec?: PodSpecShape;
};

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): SecurityHardeningStatus {
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

function parsePsaLevel(value?: string | null): PsaLevel | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return PSA_LEVELS.find((level) => level === normalized);
}

function extractWorkloads(data: ClusterData): WorkloadDescriptor[] {
  const workloads: WorkloadDescriptor[] = [];

  data.deployments.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "Deployment",
      podSpec: item.spec.template.spec,
    });
  });

  data.statefulsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "StatefulSet",
      podSpec: item.spec.template.spec,
    });
  });

  data.daemonsets.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "DaemonSet",
      podSpec: item.spec.template.spec,
    });
  });

  data.jobs.items.forEach((item) => {
    workloads.push({
      namespace: normalizeNamespace(item.metadata.namespace),
      name: item.metadata.name,
      type: "Job",
      podSpec: item.spec.template?.spec,
    });
  });

  return workloads;
}

function buildSummary(
  items: SecurityHardeningItem[],
  errorStatus?: SecurityHardeningStatus,
): SecurityHardeningSummary {
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

  let status: SecurityHardeningStatus = "ok";
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

function buildRecommendation(): string {
  return "securityContext:\n  runAsNonRoot: true\n  allowPrivilegeEscalation: false\n  readOnlyRootFilesystem: true\n  seccompProfile:\n    type: RuntimeDefault\n  capabilities:\n    drop:\n      - ALL";
}

function evaluateContainer(
  workload: WorkloadDescriptor,
  container: ContainerSpec,
  psaLevel: PsaLevel | undefined,
): SecurityHardeningItem {
  const issues: string[] = [];
  const recommendations: string[] = [];

  const podSecurityContext = workload.podSpec?.securityContext;
  const containerSecurityContext = container.securityContext;

  const runAsNonRoot = containerSecurityContext?.runAsNonRoot ?? podSecurityContext?.runAsNonRoot;
  const runAsUser = containerSecurityContext?.runAsUser ?? podSecurityContext?.runAsUser;
  const allowPrivilegeEscalation = containerSecurityContext?.allowPrivilegeEscalation;
  const readOnlyRootFilesystem = containerSecurityContext?.readOnlyRootFilesystem;
  const privileged = containerSecurityContext?.privileged;
  const seccompProfile =
    containerSecurityContext?.seccompProfile?.type ?? podSecurityContext?.seccompProfile?.type;
  const capabilityDrops = containerSecurityContext?.capabilities?.drop ?? [];
  const capabilityAdds = containerSecurityContext?.capabilities?.add ?? [];

  if (runAsNonRoot !== true && !runAsUser) {
    issues.push("runAsNonRoot is not enabled.");
  }
  if (allowPrivilegeEscalation !== false) {
    issues.push("allowPrivilegeEscalation is not false.");
  }
  if (readOnlyRootFilesystem !== true) {
    issues.push("readOnlyRootFilesystem is not true.");
  }
  if (privileged === true) {
    issues.push("privileged mode enabled.");
  }
  if (!capabilityDrops.includes("ALL")) {
    issues.push("Linux capabilities are not dropping ALL.");
  }
  if (capabilityAdds.length > 0) {
    issues.push(`Linux capabilities added: ${capabilityAdds.join(", ")}`);
  }
  if (!seccompProfile) {
    issues.push("seccompProfile is not configured.");
  } else if (seccompProfile !== "RuntimeDefault") {
    issues.push(`seccompProfile is ${seccompProfile}.`);
  }
  if (workload.podSpec?.hostNetwork) issues.push("hostNetwork enabled.");
  if (workload.podSpec?.hostPID) issues.push("hostPID enabled.");
  if (workload.podSpec?.hostIPC) issues.push("hostIPC enabled.");

  let status: SecurityHardeningStatus = "ok";
  const criticalPatterns = ["privileged mode", "allowPrivilegeEscalation", "runAsNonRoot"];
  if (issues.some((issue) => criticalPatterns.some((pattern) => issue.includes(pattern)))) {
    status = "critical";
  } else if (issues.length > 0) {
    status = psaLevel === "restricted" ? "critical" : "warning";
  }

  if (issues.length > 0) {
    recommendations.push(buildRecommendation());
  }

  return {
    namespace: workload.namespace,
    workload: workload.name,
    workloadType: workload.type,
    container: container.name,
    psaLevel: psaLevel ?? "unset",
    status,
    issues,
    recommendations,
  };
}

export async function checkSecurityHardening(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<SecurityHardeningReport> {
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
        "jobs",
        "namespaces",
      ]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load security hardening data.";
      await logError(`Security hardening check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Failed to load security hardening data.";
    await logError(`Security hardening check failed: ${errorMessage}`);
    data = null;
  }

  const items: SecurityHardeningItem[] = [];

  if (data) {
    const workloads = extractWorkloads(data);
    const namespaceLabels = new Map(
      data.namespaces.items.map((namespace) => [
        normalizeNamespace(namespace.metadata.name),
        namespace.metadata.labels,
      ]),
    );

    workloads.forEach((workload) => {
      const containers = workload.podSpec?.containers ?? [];
      const labels = namespaceLabels.get(workload.namespace);
      const psaLevel = parsePsaLevel(labels?.[PSA_ENFORCE_LABEL]);

      containers.forEach((container) => {
        items.push(evaluateContainer(workload, container, psaLevel));
      });
    });
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus);

  const report: SecurityHardeningReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
