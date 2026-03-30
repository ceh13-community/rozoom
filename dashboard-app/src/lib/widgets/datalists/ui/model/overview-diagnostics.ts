import { buildClusterHealthScore, type ClusterHealthChecks } from "$features/check-health";
import type { ClusterCheckError, WarningEventItem } from "$features/check-health/model/types";
import { buildControlPlaneChecks, detectManagedProvider } from "./overview-insights";

export type DiagnosticsSeverity = "critical" | "warning" | "info" | "ok";

export type OverviewTopRisk = {
  id: string;
  severity: DiagnosticsSeverity;
  title: string;
  reason: string;
  fix: string;
  evidence?: string;
  command: string;
  actionLabel: string;
};

export type OverviewPrimaryAlert = {
  severity: DiagnosticsSeverity;
  title: string;
  detail: string;
  command?: string;
};

export type OverviewChangeItem = {
  id: string;
  severity: DiagnosticsSeverity;
  title: string;
  detail: string;
};

export type OverviewHealthHistoryEntry = {
  capturedAt: number;
  score: number | null;
  apiSeverity: number;
  podsSeverity: number;
  nodesSeverity: number;
  controlPlaneSeverity: number;
  warningCount: number;
  crashLoopCount: number;
  pendingCount: number;
  apiP95: number | null;
  minCertificateDays: number | null;
};

export type OverviewTimelineSeries = {
  id: "api" | "pods" | "nodes" | "control-plane";
  title: string;
  points: Array<{ capturedAt: number; value: number }>;
};

export type OverviewSafeAction = {
  id: string;
  label: string;
  detail: string;
  mode: "goto" | "tab" | "copy";
  target: string;
};

const SEVERITY_RANK: Record<DiagnosticsSeverity, number> = {
  critical: 4,
  warning: 3,
  info: 2,
  ok: 1,
};

function commandForRisk(id: string): { command: string; actionLabel: string } {
  switch (id) {
    case "crashloops":
    case "pending-pods":
    case "pod-restarts":
      return { command: "kubectl get pods -A", actionLabel: "Show failing pods" };
    case "warning-events":
      return {
        command: "kubectl get events -A --field-selector type=Warning --sort-by=.lastTimestamp",
        actionLabel: "Open warning events",
      };
    case "nodes-not-ready":
    case "node-disk-pressure":
    case "node-memory-pressure":
    case "node-pid-pressure":
    case "node-network-unavailable":
      return { command: "kubectl describe nodes", actionLabel: "View node pressure" };
    case "cert-expiry":
      return {
        command: "kubectl get certificatesigningrequests",
        actionLabel: "Review certificates",
      };
    case "etcd-health":
      return {
        command: "kubectl get pods -n kube-system | grep etcd",
        actionLabel: "Inspect etcd",
      };
    case "metrics-server":
      return {
        command:
          "kubectl get deployment,pods -n kube-system | grep metrics-server && kubectl get --raw /apis/metrics.k8s.io/v1beta1/nodes && kubectl top nodes",
        actionLabel: "Inspect metrics-server",
      };
    default:
      return {
        command: "kubectl get --raw='/readyz?verbose'",
        actionLabel: "Inspect control plane",
      };
  }
}

function riskSeverity(severity: "warning" | "critical"): DiagnosticsSeverity {
  return severity === "critical" ? "critical" : "warning";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildRiskEvidence(checks: ClusterHealthChecks, riskId: string): string | undefined {
  switch (riskId) {
    case "api-health":
      return (
        asOptionalString(checks.apiServerHealth?.ready.error) ??
        asOptionalString(checks.apiServerHealth?.ready.output)
      );
    case "api-latency": {
      const overall = checks.apiServerLatency?.overall;
      const parts = [
        overall?.p50 !== undefined ? `p50 ${overall.p50.toFixed(3)}s` : null,
        overall?.p95 !== undefined ? `p95 ${overall.p95.toFixed(3)}s` : null,
        overall?.p99 !== undefined ? `p99 ${overall.p99.toFixed(3)}s` : null,
      ].filter((value): value is string => Boolean(value));
      return parts.length > 0
        ? parts.join(" · ")
        : asOptionalString(checks.apiServerLatency?.summary.message);
    }
    case "metrics-server": {
      const endpoints = checks.metricsChecks.endpoints;
      const endpoint = Object.prototype.hasOwnProperty.call(endpoints, "metrics_server")
        ? endpoints["metrics_server"]
        : Object.prototype.hasOwnProperty.call(endpoints, "metrics-server")
          ? endpoints["metrics-server"]
          : null;
      const parts = [
        endpoint ? endpoint.status : undefined,
        endpoint ? endpoint.error : undefined,
      ].filter((value): value is string => typeof value === "string" && value.length > 0);
      return parts.length > 0 ? parts.join(" · ") : undefined;
    }
    case "etcd-health": {
      const warnings = checks.etcdHealth?.summary.warnings ?? [];
      return warnings.length > 0 ? warnings.join(" · ") : undefined;
    }
    case "cert-expiry": {
      const values = (checks.certificatesHealth?.certificates ?? [])
        .map((item) => item.daysLeft)
        .filter((value): value is number => typeof value === "number");
      if (values.length === 0) return asOptionalString(checks.certificatesHealth?.summary.message);
      return `Earliest expiry in ${Math.min(...values)} day(s).`;
    }
    case "nodes-not-ready": {
      const summary = checks.nodes?.summary;
      if (!summary) return undefined;
      const notReady = Math.max(0, summary.count.total - summary.count.ready);
      return `${notReady}/${summary.count.total} node(s) are not Ready.`;
    }
    case "node-disk-pressure": {
      const count = checks.nodes?.summary.count.pressures?.diskPressure ?? 0;
      return `${count} node(s) reporting DiskPressure.`;
    }
    case "node-memory-pressure": {
      const count = checks.nodes?.summary.count.pressures?.memoryPressure ?? 0;
      return `${count} node(s) reporting MemoryPressure.`;
    }
    case "node-pid-pressure": {
      const count = checks.nodes?.summary.count.pressures?.pidPressure ?? 0;
      return `${count} node(s) reporting PIDPressure.`;
    }
    case "node-network-unavailable": {
      const count = checks.nodes?.summary.count.pressures?.networkUnavailable ?? 0;
      return `${count} node(s) reporting NetworkUnavailable.`;
    }
    case "crashloops":
      return checks.podIssues
        ? `${checks.podIssues.crashLoopCount} pod(s) currently in CrashLoopBackOff.`
        : undefined;
    case "pending-pods":
      return checks.podIssues
        ? `${checks.podIssues.pendingCount} pod(s) currently pending.`
        : undefined;
    case "pod-restarts":
      return checks.podRestarts.length > 0
        ? `${checks.podRestarts.length} workload(s) crossed restart thresholds.`
        : undefined;
    case "warning-events":
      return checks.warningEvents?.items.length
        ? `${checks.warningEvents.items.length} warning event(s) in the latest window.`
        : checks.warningEvents?.summary.message;
    default:
      return undefined;
  }
}

function statusToSeverityValue(status: string | undefined): number {
  if (status === "critical") return 3;
  if (status === "warning") return 2;
  if (status === "unavailable" || status === "unknown") return 1;
  return 0;
}

function buildControlPlaneSeverity(checks: ClusterHealthChecks, providerIds: string[]): number {
  const items = buildControlPlaneChecks({
    checks,
    isManagedCluster: detectManagedProvider(providerIds),
  }).filter((item) => item.id !== "api-server");
  return items.reduce((max, item) => Math.max(max, statusToSeverityValue(item.severity)), 0);
}

function buildNodesSeverity(checks: ClusterHealthChecks): number {
  const summary = checks.nodes?.summary;
  if (!summary) return 0;
  const total = summary.count.total;
  const ready = summary.count.ready;
  if (total > 0 && ready < total) return 3;
  const pressures = summary.count.pressures;
  if (!pressures) return 0;
  if (Object.values(pressures).some((value) => value > 0)) return 2;
  return 0;
}

function buildPodsSeverity(checks: ClusterHealthChecks): number {
  const crashLoops = checks.podIssues?.crashLoopCount ?? 0;
  const pending = checks.podIssues?.pendingCount ?? 0;
  if (crashLoops > 0) return 3;
  if (pending > 0) return 2;
  return 0;
}

function minCertificateDays(checks: ClusterHealthChecks): number | null {
  const values = (checks.certificatesHealth?.certificates ?? [])
    .map((item) => item.daysLeft)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return null;
  return Math.min(...values);
}

export function buildOverviewTopRisks(checks: ClusterHealthChecks | null): OverviewTopRisk[] {
  if (!checks) return [];
  return buildClusterHealthScore(checks)
    .topRisks.slice(0, 4)
    .map((risk) => {
      const command = commandForRisk(risk.id);
      return {
        id: risk.id,
        severity: riskSeverity(risk.severity),
        title: risk.title,
        reason: risk.reason,
        fix: risk.fix,
        evidence: buildRiskEvidence(checks, risk.id),
        command: command.command,
        actionLabel: command.actionLabel,
      };
    });
}

function isCheckError(v: unknown): v is ClusterCheckError {
  return v != null && typeof v === "object" && "errors" in v && !("pods" in v);
}

export function isConnectionError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("connect etimedout") ||
    lower.includes("no route to host") ||
    lower.includes("certificate") ||
    lower.includes("tls") ||
    lower.includes("x509") ||
    lower.includes("unauthorized") ||
    lower.includes("403") ||
    lower.includes("forbidden") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo")
  );
}

export function humanizeClusterError(raw: string): { title: string; detail: string } {
  const lower = raw.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("connect etimedout") ||
    lower.includes("no route to host")
  ) {
    return {
      title: "Cluster unreachable",
      detail:
        "Cannot connect to the Kubernetes API server. Make sure the cluster is running and the kubeconfig is correct.",
    };
  }
  if (lower.includes("certificate") || lower.includes("tls") || lower.includes("x509")) {
    return {
      title: "TLS/certificate error",
      detail:
        "The cluster API server rejected the connection due to a certificate issue. Check your kubeconfig certificates.",
    };
  }
  if (lower.includes("unauthorized") || lower.includes("403") || lower.includes("forbidden")) {
    return {
      title: "Authentication failed",
      detail: "Access to the cluster was denied. Verify your credentials and RBAC permissions.",
    };
  }
  if (lower.includes("timeout") || lower.includes("etimedout") || lower.includes("deadline")) {
    return {
      title: "Connection timed out",
      detail:
        "The cluster API server did not respond in time. The cluster may be overloaded or unreachable.",
    };
  }
  if (lower.includes("not found") || lower.includes("enotfound") || lower.includes("getaddrinfo")) {
    return {
      title: "Cluster not found",
      detail:
        "DNS resolution failed for the API server address. Check if the cluster hostname is correct.",
    };
  }
  return {
    title: "Health check failed",
    detail: raw || "An unknown error occurred while checking cluster health.",
  };
}

export function buildPrimaryAlert(
  checks: ClusterHealthChecks | ClusterCheckError | null,
): OverviewPrimaryAlert {
  if (!checks) {
    return {
      severity: "info",
      title: "No diagnostics yet",
      detail: "Run or wait for health checks to populate cluster health.",
    };
  }
  if (isCheckError(checks)) {
    const friendly = humanizeClusterError(checks.errors);
    return {
      severity: "critical",
      title: friendly.title,
      detail: friendly.detail,
    };
  }
  const topRisk = buildOverviewTopRisks(checks).at(0);
  if (topRisk) {
    return {
      severity: topRisk.severity,
      title: topRisk.title,
      detail: topRisk.reason,
      command: topRisk.command,
    };
  }
  return {
    severity: "ok",
    title: "Healthy",
    detail: "No major cluster risks detected in the latest health check.",
    command: "kubectl get nodes && kubectl get pods -A",
  };
}

export function captureOverviewHealthHistoryEntry(params: {
  checks: ClusterHealthChecks | null;
  warningItems: WarningEventItem[];
  providerIds: string[];
  capturedAt?: number;
}): OverviewHealthHistoryEntry | null {
  const checks = params.checks;
  if (!checks) return null;
  const score = buildClusterHealthScore(checks).score;
  return {
    capturedAt: params.capturedAt ?? Date.now(),
    score,
    apiSeverity: Math.max(
      statusToSeverityValue(checks.apiServerHealth?.status),
      statusToSeverityValue(checks.apiServerLatency?.status),
    ),
    podsSeverity: buildPodsSeverity(checks),
    nodesSeverity: buildNodesSeverity(checks),
    controlPlaneSeverity: buildControlPlaneSeverity(checks, params.providerIds),
    warningCount: params.warningItems.length,
    crashLoopCount: checks.podIssues?.crashLoopCount ?? 0,
    pendingCount: checks.podIssues?.pendingCount ?? 0,
    apiP95: checks.apiServerLatency?.overall.p95 ?? null,
    minCertificateDays: minCertificateDays(checks),
  };
}

export function buildChangeSinceLastCheck(
  current: OverviewHealthHistoryEntry | null,
  previous: OverviewHealthHistoryEntry | null,
): OverviewChangeItem[] {
  if (!current || !previous) return [];

  const changes: OverviewChangeItem[] = [];

  if (current.score !== null && previous.score !== null) {
    const scoreDelta = Math.round(current.score - previous.score);
    if (scoreDelta <= -5) {
      changes.push({
        id: "score-worse",
        severity: "warning",
        title: "Overall health worsened",
        detail: `Cluster health score dropped by ${Math.abs(scoreDelta)} points since the last check.`,
      });
    } else if (scoreDelta >= 5) {
      changes.push({
        id: "score-better",
        severity: "info",
        title: "Overall health improved",
        detail: `Cluster health score improved by ${scoreDelta} points since the last check.`,
      });
    }
  }

  const warningDelta = current.warningCount - previous.warningCount;
  if (warningDelta > 0) {
    changes.push({
      id: "warning-events",
      severity: warningDelta >= 5 ? "critical" : "warning",
      title: "New warning events",
      detail: `${warningDelta} additional warning event(s) appeared since the last check.`,
    });
  }

  const crashLoopDelta = current.crashLoopCount - previous.crashLoopCount;
  if (crashLoopDelta > 0) {
    changes.push({
      id: "crashloops",
      severity: "critical",
      title: "More pods entered CrashLoopBackOff",
      detail: `${crashLoopDelta} additional pod(s) are crashing.`,
    });
  }

  const pendingDelta = current.pendingCount - previous.pendingCount;
  if (pendingDelta > 0) {
    changes.push({
      id: "pending-pods",
      severity: "warning",
      title: "Pending pods increased",
      detail: `${pendingDelta} more pod(s) are pending scheduling or startup.`,
    });
  }

  if (
    current.apiP95 !== null &&
    previous.apiP95 !== null &&
    current.apiP95 > previous.apiP95 + 250
  ) {
    changes.push({
      id: "api-latency",
      severity: current.apiP95 > previous.apiP95 * 1.5 ? "critical" : "warning",
      title: "API latency increased",
      detail: `API p95 latency rose from ${Math.round(previous.apiP95)}ms to ${Math.round(current.apiP95)}ms.`,
    });
  }

  if (
    current.minCertificateDays !== null &&
    previous.minCertificateDays !== null &&
    current.minCertificateDays < previous.minCertificateDays &&
    current.minCertificateDays <= 30
  ) {
    changes.push({
      id: "certificates",
      severity: current.minCertificateDays <= 7 ? "critical" : "warning",
      title: "Certificate expiry is getting closer",
      detail: `Nearest certificate now expires in ${current.minCertificateDays} day(s).`,
    });
  }

  if (current.controlPlaneSeverity > previous.controlPlaneSeverity) {
    changes.push({
      id: "control-plane",
      severity: current.controlPlaneSeverity >= 3 ? "critical" : "warning",
      title: "Control plane risk increased",
      detail: "Control-plane checks degraded compared with the previous sample.",
    });
  }

  return changes
    .sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity])
    .slice(0, 5);
}

export function buildHealthTimeline(
  history: OverviewHealthHistoryEntry[],
  windowMs: number,
  now = Date.now(),
): OverviewTimelineSeries[] {
  const filtered = history
    .filter((entry) => entry.capturedAt >= now - windowMs)
    .sort((left, right) => left.capturedAt - right.capturedAt);

  const points = filtered.length > 0 ? filtered : history.slice(-1);

  return [
    {
      id: "api",
      title: "API",
      points: points.map((entry) => ({ capturedAt: entry.capturedAt, value: entry.apiSeverity })),
    },
    {
      id: "pods",
      title: "Pods",
      points: points.map((entry) => ({ capturedAt: entry.capturedAt, value: entry.podsSeverity })),
    },
    {
      id: "nodes",
      title: "Nodes",
      points: points.map((entry) => ({ capturedAt: entry.capturedAt, value: entry.nodesSeverity })),
    },
    {
      id: "control-plane",
      title: "Control plane",
      points: points.map((entry) => ({
        capturedAt: entry.capturedAt,
        value: entry.controlPlaneSeverity,
      })),
    },
  ];
}

export function buildOverviewSafeActions(params: {
  checks: ClusterHealthChecks | null;
  warningItems: WarningEventItem[];
}): OverviewSafeAction[] {
  const actions: OverviewSafeAction[] = [];
  const checks = params.checks;
  if (!checks) {
    return [
      {
        id: "copy-baseline",
        label: "Copy kubectl",
        detail: "Copy a baseline cluster inspection command.",
        mode: "copy",
        target: "kubectl get nodes && kubectl get pods -A",
      },
    ];
  }

  if ((checks.podIssues?.crashLoopCount ?? 0) > 0 || (checks.podIssues?.pendingCount ?? 0) > 0) {
    actions.push({
      id: "failing-pods",
      label: "Show failing pods",
      detail: "Open pods diagnostics for crash loops and pending workloads.",
      mode: "goto",
      target: "podsrestarts",
    });
  }

  if (params.warningItems.length > 0) {
    actions.push({
      id: "warning-events",
      label: "Open warning events",
      detail: "Jump to the live warning events panel.",
      mode: "tab",
      target: "events",
    });
  }

  const pressures = checks.nodes?.summary.count.pressures;
  const pressureCount = pressures
    ? Object.values(pressures).reduce((sum, value) => sum + value, 0)
    : 0;
  if (
    pressureCount > 0 ||
    (checks.nodes?.summary.count.ready ?? 0) < (checks.nodes?.summary.count.total ?? 0)
  ) {
    actions.push({
      id: "node-pressure",
      label: "View node pressure",
      detail: "Inspect nodes with pressure or readiness issues.",
      mode: "goto",
      target: "nodespressures",
    });
  }

  actions.push({
    id: "inspect-kube-system",
    label: "Inspect kube-system",
    detail: "Copy a command to inspect control-plane pods and addons.",
    mode: "copy",
    target: "kubectl get pods -n kube-system -o wide",
  });

  const topRisk = buildOverviewTopRisks(checks).at(0);
  if (topRisk) {
    actions.push({
      id: "copy-top-command",
      label: "Copy kubectl",
      detail: `Copy the suggested command for: ${topRisk.title}.`,
      mode: "copy",
      target: topRisk.command,
    });
  }

  return actions.slice(0, 5);
}
