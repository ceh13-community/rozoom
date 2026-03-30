import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, PodItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  PodSecurityNamespaceItem,
  PodSecurityReport,
  PodSecurityStatus,
  PodSecuritySummary,
  PodSecurityViolationItem,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: PodSecurityReport; fetchedAt: number }>();

const PSA_LABELS = {
  enforce: "pod-security.kubernetes.io/enforce",
  warn: "pod-security.kubernetes.io/warn",
  audit: "pod-security.kubernetes.io/audit",
};

const PSA_LEVELS = ["privileged", "baseline", "restricted"] as const;
type PsaLevel = (typeof PSA_LEVELS)[number];

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);

const ALLOWED_HOST_PATH_PREFIXES = ["/var/run", "/var/log", "/etc/hosts", "/etc/resolv.conf"];

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): PodSecurityStatus {
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

function isAllowedHostPath(path: string): boolean {
  return ALLOWED_HOST_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function buildSummary(
  namespaceItems: PodSecurityNamespaceItem[],
  violationItems: PodSecurityViolationItem[],
  errorStatus?: PodSecurityStatus,
  psaDisabled?: boolean,
): PodSecuritySummary {
  const combined = [...namespaceItems, ...violationItems];
  const totals = combined.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "ok") acc.ok += 1;
      if (item.status === "warning") acc.warning += 1;
      if (item.status === "critical") acc.critical += 1;
      return acc;
    },
    { total: 0, ok: 0, warning: 0, critical: 0 },
  );

  let status: PodSecurityStatus = "ok";
  if (errorStatus) {
    status = errorStatus;
  } else if (psaDisabled) {
    status = "warning";
  } else if (totals.critical > 0) {
    status = "critical";
  } else if (totals.warning > 0) {
    status = "warning";
  }

  let message = "OK";
  if (status === "warning") {
    message = psaDisabled ? "Warning (PSA disabled)" : `Warning (${totals.warning})`;
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

function evaluateNamespace(
  namespace: string,
  labels?: Record<string, string>,
): PodSecurityNamespaceItem {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const enforce = parsePsaLevel(labels?.[PSA_LABELS.enforce]);
  const warn = parsePsaLevel(labels?.[PSA_LABELS.warn]);
  const audit = parsePsaLevel(labels?.[PSA_LABELS.audit]);

  const isSystem = SYSTEM_NAMESPACES.has(namespace);

  if (!enforce) {
    issues.push("PSA enforce label is missing.");
    recommendations.push(
      "pod-security.kubernetes.io/enforce: restricted\npod-security.kubernetes.io/audit: restricted\npod-security.kubernetes.io/warn: restricted",
    );
  } else if (enforce === "privileged" && !isSystem) {
    issues.push("Namespace enforces privileged policy.");
  } else if (enforce === "baseline" && !isSystem) {
    issues.push("Namespace enforces baseline instead of restricted.");
  }

  if (!warn || !audit) {
    issues.push("PSA warn/audit labels are not fully configured.");
  }

  if (enforce && warn && warn !== enforce) {
    issues.push("PSA warn level differs from enforce.");
  }
  if (enforce && audit && audit !== enforce) {
    issues.push("PSA audit level differs from enforce.");
  }

  let status: PodSecurityStatus = "ok";
  if (!enforce && !isSystem) {
    status = "critical";
  } else if (issues.length > 0) {
    status = enforce === "privileged" && !isSystem ? "critical" : "warning";
  }

  return {
    namespace,
    enforce: enforce ?? "unset",
    warn: warn ?? "unset",
    audit: audit ?? "unset",
    status,
    issues,
    recommendations,
  };
}

function buildSecurityContextRecommendation(): string {
  return 'securityContext:\n  runAsNonRoot: true\n  allowPrivilegeEscalation: false\n  readOnlyRootFilesystem: true\n  capabilities:\n    drop: ["ALL"]';
}

function buildPsaNamespaceRecommendation(): string {
  return "pod-security.kubernetes.io/enforce: restricted\npod-security.kubernetes.io/audit: restricted\npod-security.kubernetes.io/warn: restricted";
}

function evaluatePod(
  pod: PodItem,
  enforceLevel: PsaLevel | undefined,
  namespaceHasEnforce: boolean,
): PodSecurityViolationItem[] {
  const namespace = normalizeNamespace(pod.metadata.namespace);
  const violations: PodSecurityViolationItem[] = [];

  const hostAccessIssues: string[] = [];
  if (pod.spec.hostNetwork) hostAccessIssues.push("hostNetwork enabled.");
  if (pod.spec.hostPID) hostAccessIssues.push("hostPID enabled.");
  if (pod.spec.hostIPC) hostAccessIssues.push("hostIPC enabled.");

  const hostPathIssues: string[] = [];
  (pod.spec.volumes ?? []).forEach((volume) => {
    const hostPath = volume.hostPath?.path;
    if (hostPath && !isAllowedHostPath(hostPath)) {
      hostPathIssues.push(`hostPath used: ${hostPath}`);
    }
  });

  pod.spec.containers.forEach((container) => {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!namespaceHasEnforce) {
      issues.push("Namespace missing PSA enforce label.");
      recommendations.push(buildPsaNamespaceRecommendation());
    }

    if (!enforceLevel) {
      issues.push("PSA enforce level is unset or invalid.");
    }

    const podSecurityContext = pod.spec.securityContext;
    const containerSecurityContext = container.securityContext;

    const runAsNonRoot = containerSecurityContext?.runAsNonRoot ?? podSecurityContext?.runAsNonRoot;
    const runAsUser = containerSecurityContext?.runAsUser ?? podSecurityContext?.runAsUser;
    const allowPrivilegeEscalation = containerSecurityContext?.allowPrivilegeEscalation;
    const readOnlyRootFilesystem = containerSecurityContext?.readOnlyRootFilesystem;
    const privileged = containerSecurityContext?.privileged;
    const capabilityDrops = containerSecurityContext?.capabilities?.drop ?? [];

    if (enforceLevel === "restricted") {
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
      if (hostAccessIssues.length > 0) {
        issues.push(...hostAccessIssues);
      }
      if (hostPathIssues.length > 0) {
        issues.push(...hostPathIssues);
      }
      if (issues.length > 0) {
        recommendations.push(buildSecurityContextRecommendation());
      }
    } else if (enforceLevel === "baseline") {
      if (privileged === true) {
        issues.push("privileged mode enabled.");
      }
      if (allowPrivilegeEscalation === true) {
        issues.push("allowPrivilegeEscalation is true.");
      }
      if (hostAccessIssues.length > 0) {
        issues.push(...hostAccessIssues);
      }
      if (hostPathIssues.length > 0) {
        issues.push(...hostPathIssues);
      }
    }

    let status: PodSecurityStatus = "ok";
    if (issues.length > 0) {
      status = enforceLevel === "restricted" ? "critical" : "warning";
    }

    if (issues.length > 0) {
      violations.push({
        namespace,
        pod: pod.metadata.name,
        container: container.name,
        enforceLevel: enforceLevel ?? "unset",
        status,
        issues,
        recommendations,
      });
    }
  });

  return violations;
}

export async function checkPodSecurity(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<PodSecurityReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let data: ClusterData | null = null;

  try {
    data =
      options?.data ?? (await loadClusterEntities({ uuid: clusterId }, ["pods", "namespaces"]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load pod security data.";
      await logError(`Pod security check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load pod security data.";
    await logError(`Pod security check failed: ${errorMessage}`);
    data = null;
  }

  const namespaceItems: PodSecurityNamespaceItem[] = [];
  const violationItems: PodSecurityViolationItem[] = [];
  let psaDisabled = false;

  if (data) {
    data.namespaces.items.forEach((namespace) => {
      const ns = normalizeNamespace(namespace.metadata.name);
      const labels = namespace.metadata.labels;
      const namespaceItem = evaluateNamespace(ns, labels);
      namespaceItems.push(namespaceItem);
      if (namespaceItem.enforce === "unset") {
        psaDisabled = true;
      }
    });

    const namespaceMap = new Map(namespaceItems.map((item) => [item.namespace, item]));

    data.pods.items.forEach((pod) => {
      const namespace = normalizeNamespace(pod.metadata.namespace);
      const namespaceItem = namespaceMap.get(namespace);
      const enforceLevel = namespaceItem?.enforce;
      const parsedEnforce = parsePsaLevel(enforceLevel === "unset" ? undefined : enforceLevel);
      const namespaceHasEnforce = enforceLevel !== undefined && enforceLevel !== "unset";

      violationItems.push(...evaluatePod(pod, parsedEnforce, namespaceHasEnforce));
    });
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(namespaceItems, violationItems, errorStatus, psaDisabled);

  const report: PodSecurityReport = {
    status: summary.status,
    summary,
    namespaces: namespaceItems,
    items: violationItems,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
