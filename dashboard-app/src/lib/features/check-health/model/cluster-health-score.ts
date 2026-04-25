import type {
  ApiServerHealthStatus,
  ApiServerLatencyStatus,
  ApfHealthStatus,
  BlackboxProbeStatus,
  ClusterHealthChecks,
  EtcdHealthStatus,
  WarningEventsStatus,
} from "./types";

const DOMAIN_WEIGHTS = {
  controlPlane: 35,
  nodes: 25,
  workloads: 20,
  observability: 10,
  platform: 10,
} as const;

type HealthDomain = keyof typeof DOMAIN_WEIGHTS;

type HealthSeverity = "warning" | "critical";

export type ClusterHealthScoreStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export type ClusterHealthRiskItem = {
  id: string;
  domain: HealthDomain;
  severity: HealthSeverity;
  title: string;
  reason: string;
  fix: string;
  penalty: number;
  references: string[];
};

export type ClusterHealthDomainSummary = {
  domain: HealthDomain;
  label: string;
  weight: number;
  score: number | null;
  penalty: number;
  risks: ClusterHealthRiskItem[];
};

export type ClusterHealthScoreSummary = {
  score: number | null;
  status: ClusterHealthScoreStatus;
  statusLabel: string;
  domains: ClusterHealthDomainSummary[];
  risks: ClusterHealthRiskItem[];
  topRisks: ClusterHealthRiskItem[];
  scoreDelta: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getStatusLabel = (status: ClusterHealthScoreStatus) => {
  if (status === "healthy") return "Healthy";
  if (status === "degraded") return "Degraded";
  if (status === "unhealthy") return "Unhealthy";
  return "Unknown";
};

const normalizeStatusPenalty = (
  status: ApiServerHealthStatus | ApiServerLatencyStatus | ApfHealthStatus | EtcdHealthStatus,
  criticalPenalty: number,
  warningPenalty: number,
) => {
  if (status === "critical") return criticalPenalty;
  if (status === "warning") return warningPenalty;
  return 0;
};

const normalizeOptionalStatusPenalty = (
  status:
    | ApiServerHealthStatus
    | ApiServerLatencyStatus
    | ApfHealthStatus
    | EtcdHealthStatus
    | WarningEventsStatus
    | BlackboxProbeStatus
    | undefined,
  criticalPenalty: number,
  warningPenalty: number,
) => {
  if (!status) return 0;
  if (status === "critical") return criticalPenalty;
  if (status === "warning") return warningPenalty;
  return 0;
};

const resolveMetricsEndpoint = (endpoints: ClusterHealthChecks["metricsChecks"]["endpoints"]) =>
  Object.entries(endpoints).map(([key, value]) => ({ key: key.toLowerCase(), value }));

const hasEndpoint = (
  endpoints: Array<{ key: string; value: { installed?: boolean; error?: string } }>,
  pattern: RegExp,
) => endpoints.some((endpoint) => pattern.test(endpoint.key));

const isEndpointHealthy = (
  endpoints: Array<{ key: string; value: { installed?: boolean; error?: string } }>,
  pattern: RegExp,
) => {
  const match = endpoints.find((endpoint) => pattern.test(endpoint.key));
  if (!match) return false;
  if (match.value.installed === false) return false;
  if (match.value.error) return false;
  return true;
};

// Decide whether an observability endpoint should contribute to the cluster
// health score. We penalize only when we have positive evidence the addon
// itself is degraded - crashlooping pods, OOM, RBAC failures against the
// addon's own API, and so on.
//
// The following states are NOT penalized:
//   - `installed: false` or endpoint missing: the operator did not deploy
//     this optional addon. Common on managed clusters (EKS etc.) that do
//     not pre-install metrics-server / kube-state-metrics / node-exporter,
//     and on any cluster that skipped the Prometheus stack. Deployment
//     choice, not a health signal.
//   - `status` contains "unreachable": the probe could not reach the addon
//     (service-proxy rejected, kubelet auth mismatch, transient aggregated
//     API 503, VPC routing). The addon's own pods may be Ready and
//     serving. Probe-layer issues should not masquerade as cluster health
//     degradation.
const isEndpointInstalledButUnhealthy = (
  endpoints: Array<{
    key: string;
    value: { installed?: boolean; error?: string; status?: string };
  }>,
  pattern: RegExp,
) => {
  const match = endpoints.find((endpoint) => pattern.test(endpoint.key));
  if (!match) return false;
  if (match.value.installed === false) return false;
  if (!match.value.error) return false;
  const statusText = (match.value.status ?? "").toLowerCase();
  if (statusText.includes("unreachable")) return false;
  return true;
};

const createRisk = (risk: Omit<ClusterHealthRiskItem, "penalty"> & { penalty: number }) => ({
  ...risk,
  penalty: clamp(risk.penalty, 1, DOMAIN_WEIGHTS[risk.domain]),
});

export const buildClusterHealthScore = (
  checks: ClusterHealthChecks | null,
): ClusterHealthScoreSummary => {
  if (!checks) {
    return {
      score: null,
      status: "unknown",
      statusLabel: getStatusLabel("unknown"),
      domains: [],
      risks: [],
      topRisks: [],
      scoreDelta: 0,
    };
  }

  const risks: ClusterHealthRiskItem[] = [];

  const apiServerHealth = checks.apiServerHealth;
  const apiServerLatency = checks.apiServerLatency;
  const apfHealth = checks.apfHealth;
  const admissionWebhooks = checks.admissionWebhooks;
  const etcdHealth = checks.etcdHealth;
  const certificates = checks.certificatesHealth;
  const nodesSummary = checks.nodes?.summary;
  const podIssues = checks.podIssues;
  const cronJobsHealth = checks.cronJobsHealth;
  const warningEvents = checks.warningEvents;
  const blackboxProbes = checks.blackboxProbes;
  const metricsEndpoints = resolveMetricsEndpoint(checks.metricsChecks.endpoints);

  if (apiServerHealth) {
    const penalty = normalizeStatusPenalty(apiServerHealth.status, 20, 10);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "api-health",
          domain: "controlPlane",
          severity: apiServerHealth.status === "critical" ? "critical" : "warning",
          title: "API server /readyz is failing",
          reason: "Control plane cannot accept or serve requests reliably.",
          fix: "Inspect apiserver readiness, auth, and storage dependencies.",
          penalty,
          references: [],
        }),
      );
    }
  }

  if (apiServerLatency) {
    const penalty = normalizeStatusPenalty(apiServerLatency.status, 15, 8);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "api-latency",
          domain: "controlPlane",
          severity: apiServerLatency.status === "critical" ? "critical" : "warning",
          title: "API latency is high",
          reason: "Slow API responses delay scheduling and operations.",
          fix: "Review API server load, etcd performance, and webhook latency.",
          penalty,
          references: apiServerLatency.summary.warnings,
        }),
      );
    }
  }

  if (apfHealth) {
    const penalty = normalizeStatusPenalty(apfHealth.status, 15, 8);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "apf-saturation",
          domain: "controlPlane",
          severity: apfHealth.status === "critical" ? "critical" : "warning",
          title: "API Priority & Fairness saturated",
          reason: "Queued or rejected requests indicate API overload.",
          fix: "Reduce load or tune APF priority levels and concurrency limits.",
          penalty,
          references: apfHealth.summary.warnings,
        }),
      );
    }
  }

  if (admissionWebhooks) {
    const penalty = normalizeOptionalStatusPenalty(admissionWebhooks.status, 10, 5);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "webhook-latency",
          domain: "controlPlane",
          severity: admissionWebhooks.status === "critical" ? "critical" : "warning",
          title: "Admission webhooks are slow or failing",
          reason: "Slow webhooks block API writes and can stall deployments.",
          fix: "Fix webhook backends or set timeouts and failure policies.",
          penalty,
          references: admissionWebhooks.summary.warnings,
        }),
      );
    }
  }

  if (etcdHealth) {
    const penalty = normalizeStatusPenalty(etcdHealth.status, 20, 10);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "etcd-health",
          domain: "controlPlane",
          severity: etcdHealth.status === "critical" ? "critical" : "warning",
          title: "etcd health degraded",
          reason: "etcd instability threatens control plane availability.",
          fix: "Check etcd endpoints, disk latency, and quorum health.",
          penalty,
          references: etcdHealth.summary.warnings,
        }),
      );
    }
  }

  if (certificates) {
    const penalty = normalizeOptionalStatusPenalty(certificates.status, 6, 3);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "cert-expiry",
          domain: "controlPlane",
          severity: certificates.status === "critical" ? "critical" : "warning",
          title: "Certificates expiring soon",
          reason: "Expired certificates can break control plane auth.",
          fix: "Rotate expiring certificates and validate kubelet rotations.",
          penalty,
          references: certificates.summary.warnings,
        }),
      );
    }
  }

  if (nodesSummary) {
    const totalNodes = nodesSummary.count.total;
    const readyNodes = nodesSummary.count.ready;
    if (totalNodes > 0 && readyNodes < totalNodes) {
      risks.push(
        createRisk({
          id: "nodes-not-ready",
          domain: "nodes",
          severity: "critical",
          title: `NotReady nodes (${totalNodes - readyNodes})`,
          reason: "NotReady nodes reduce capacity and can drop workloads.",
          fix: "Investigate node connectivity, kubelet status, and resource pressure.",
          penalty: 10,
          references: [],
        }),
      );
    }

    const pressures = nodesSummary.count.pressures ?? {
      diskPressure: 0,
      memoryPressure: 0,
      pidPressure: 0,
      networkUnavailable: 0,
    };

    if (pressures.diskPressure > 0) {
      risks.push(
        createRisk({
          id: "node-disk-pressure",
          domain: "nodes",
          severity: "warning",
          title: `DiskPressure nodes (${pressures.diskPressure})`,
          reason: "Disk pressure triggers evictions and node instability.",
          fix: "Free disk space or expand node storage.",
          penalty: 8,
          references: [],
        }),
      );
    }

    if (pressures.memoryPressure > 0) {
      risks.push(
        createRisk({
          id: "node-memory-pressure",
          domain: "nodes",
          severity: "warning",
          title: `MemoryPressure nodes (${pressures.memoryPressure})`,
          reason: "Memory pressure leads to pod evictions and OOMs.",
          fix: "Add memory capacity or reduce memory usage.",
          penalty: 8,
          references: [],
        }),
      );
    }

    if (pressures.pidPressure > 0) {
      risks.push(
        createRisk({
          id: "node-pid-pressure",
          domain: "nodes",
          severity: "warning",
          title: `PIDPressure nodes (${pressures.pidPressure})`,
          reason: "PID exhaustion prevents workloads from starting.",
          fix: "Reduce process counts or tune PID limits.",
          penalty: 8,
          references: [],
        }),
      );
    }

    if (pressures.networkUnavailable > 0) {
      risks.push(
        createRisk({
          id: "node-network-unavailable",
          domain: "nodes",
          severity: "warning",
          title: `NetworkUnavailable nodes (${pressures.networkUnavailable})`,
          reason: "Network issues isolate nodes from the cluster.",
          fix: "Validate CNI health and node networking.",
          penalty: 8,
          references: [],
        }),
      );
    }
  }

  if (podIssues) {
    if (podIssues.crashLoopCount > 0) {
      risks.push(
        createRisk({
          id: "crashloops",
          domain: "workloads",
          severity: "critical",
          title: `CrashLoopBackOff pods (${podIssues.crashLoopCount})`,
          reason: "Crash loops indicate failing workloads and unstable releases.",
          fix: "Inspect logs, revert deployments, or fix container configs.",
          penalty: 6,
          references: [],
        }),
      );
    }

    if (podIssues.pendingCount > 0) {
      risks.push(
        createRisk({
          id: "pending-pods",
          domain: "workloads",
          severity: "warning",
          title: `Pending pods (${podIssues.pendingCount})`,
          reason: "Pending pods mean scheduling constraints or resource shortages.",
          fix: "Review pending reasons and available cluster capacity.",
          penalty: 6,
          references: [],
        }),
      );
    }
  }

  if (checks.podRestarts.length > 0) {
    risks.push(
      createRisk({
        id: "pod-restarts",
        domain: "workloads",
        severity: "warning",
        title: "Pod restart spikes detected",
        reason: "Frequent restarts indicate unstable workloads.",
        fix: "Investigate crashing containers and recent deployments.",
        penalty: 5,
        references: [],
      }),
    );
  }

  const storageStatus = (checks as Record<string, unknown>).storageStatus as
    | { summary?: { pendingPVCs?: number; lostPVCs?: number } }
    | undefined;
  if (storageStatus?.summary) {
    const pendingPVCs = storageStatus.summary.pendingPVCs ?? 0;
    const lostPVCs = storageStatus.summary.lostPVCs ?? 0;
    if (lostPVCs > 0) {
      risks.push(
        createRisk({
          id: "pvc-lost",
          domain: "workloads",
          severity: "critical",
          title: `Lost PVCs (${lostPVCs})`,
          reason: "Lost PVCs indicate data loss or storage backend failure.",
          fix: "Investigate storage provisioner and reclaim policies.",
          penalty: 10,
          references: [],
        }),
      );
    } else if (pendingPVCs > 0) {
      risks.push(
        createRisk({
          id: "pvc-pending",
          domain: "workloads",
          severity: "warning",
          title: `Pending PVCs (${pendingPVCs})`,
          reason: "Pending PVCs block stateful workloads from starting.",
          fix: "Check storage class availability and provisioner health.",
          penalty: 6,
          references: [],
        }),
      );
    }
  }

  if (cronJobsHealth.summary.critical > 0) {
    risks.push(
      createRisk({
        id: "cronjobs-critical",
        domain: "workloads",
        severity: "warning",
        title: `Failed CronJobs (${cronJobsHealth.summary.critical})`,
        reason: "Failed or stuck cron jobs can block scheduled operations.",
        fix: "Check cron job failures and reschedule as needed.",
        penalty: 6,
        references: [],
      }),
    );
  } else if (cronJobsHealth.summary.warning > 0) {
    risks.push(
      createRisk({
        id: "cronjobs-warning",
        domain: "workloads",
        severity: "warning",
        title: `CronJobs warnings (${cronJobsHealth.summary.warning})`,
        reason: "Missed or long-running cron jobs delay scheduled tasks.",
        fix: "Inspect cron schedules and job runtime limits.",
        penalty: 3,
        references: [],
      }),
    );
  }

  const prometheusHealthy = isEndpointHealthy(metricsEndpoints, /prometheus/);
  const alertmanagerHealthy = isEndpointHealthy(metricsEndpoints, /alertmanager/);

  // Observability addons (metrics-server, kube-state-metrics, node-exporter)
  // are penalized only when deployed-but-broken. Their absence is a
  // deployment choice - managed clusters (EKS in particular) do not
  // pre-install them, and self-managed clusters may skip Prometheus-stack
  // entirely. An addon that reports `installed: false` or is missing from
  // the metrics-check output should not make the cluster yellow or red.

  if (isEndpointInstalledButUnhealthy(metricsEndpoints, /metrics[-_ ]?server/)) {
    risks.push(
      createRisk({
        id: "metrics-server",
        domain: "observability",
        severity: "critical",
        title: "metrics-server unavailable",
        reason: "Resource metrics are unavailable or incomplete, reducing visibility.",
        fix: "Restore metrics-server health.",
        penalty: 10,
        references: [],
      }),
    );
  }

  if (isEndpointInstalledButUnhealthy(metricsEndpoints, /kube[-_ ]?state/)) {
    risks.push(
      createRisk({
        id: "kube-state-metrics",
        domain: "observability",
        severity: "warning",
        title: "kube-state-metrics degraded",
        reason: "Workload state metrics are unavailable.",
        fix: "Check the kube-state-metrics deployment for crashloops or RBAC errors.",
        penalty: 6,
        references: [],
      }),
    );
  }

  if (isEndpointInstalledButUnhealthy(metricsEndpoints, /node[-_ ]?exporter/)) {
    risks.push(
      createRisk({
        id: "node-exporter",
        domain: "observability",
        severity: "warning",
        title: "node-exporter degraded",
        reason: "Node-level metrics are unavailable.",
        fix: "Check the node-exporter DaemonSet for pod failures.",
        penalty: 6,
        references: [],
      }),
    );
  }

  if (hasEndpoint(metricsEndpoints, /prometheus/) && !prometheusHealthy) {
    risks.push(
      createRisk({
        id: "prometheus",
        domain: "observability",
        severity: "warning",
        title: "Prometheus unavailable",
        reason: "Alerting and metrics storage are degraded.",
        fix: "Restore Prometheus deployment or storage backend.",
        penalty: 8,
        references: [],
      }),
    );
  }

  if (hasEndpoint(metricsEndpoints, /alertmanager/) && !alertmanagerHealthy) {
    risks.push(
      createRisk({
        id: "alertmanager",
        domain: "observability",
        severity: "warning",
        title: "Alertmanager unavailable",
        reason: "Alert delivery is degraded.",
        fix: "Restore Alertmanager deployment or routing config.",
        penalty: 5,
        references: [],
      }),
    );
  }

  if (warningEvents) {
    const penalty = normalizeOptionalStatusPenalty(warningEvents.status, 5, 3);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "warning-events",
          domain: "observability",
          severity: warningEvents.status === "critical" ? "critical" : "warning",
          title: "Warning events spiking",
          reason: "Warning events highlight ongoing runtime failures.",
          fix: "Inspect recent events to find failing components.",
          penalty,
          references: warningEvents.summary.warnings,
        }),
      );
    }
  }

  if (blackboxProbes) {
    const penalty = normalizeOptionalStatusPenalty(blackboxProbes.status, 10, 4);
    if (penalty > 0) {
      risks.push(
        createRisk({
          id: "blackbox",
          domain: "platform",
          severity: blackboxProbes.status === "critical" ? "critical" : "warning",
          title: "Synthetic checks failing",
          reason: "Service or ingress probes indicate user-facing issues.",
          fix: "Check failing targets, TLS expiry, and routing configuration.",
          penalty,
          references: blackboxProbes.summary.warnings,
        }),
      );
    }
  }

  if (apiServerLatency?.status === "critical" && admissionWebhooks?.status === "warning") {
    risks.push(
      createRisk({
        id: "latency-webhook-correlation",
        domain: "controlPlane",
        severity: "warning",
        title: "API latency + webhook slowness",
        reason: "Slow webhooks can amplify API latency under load.",
        fix: "Optimize webhook backends or reduce webhook usage.",
        penalty: 6,
        references: [],
      }),
    );
  }

  if (podIssues?.pendingCount && nodesSummary?.count.pressures) {
    const hasPressure = Object.values(nodesSummary.count.pressures).some((value) => value > 0);
    if (hasPressure) {
      risks.push(
        createRisk({
          id: "pending-pressure-correlation",
          domain: "nodes",
          severity: "warning",
          title: "Pending pods + node pressure",
          reason: "Node pressure limits scheduling and triggers evictions.",
          fix: "Relieve node pressure or add capacity.",
          penalty: 6,
          references: [],
        }),
      );
    }
  }

  const domainSummaries: ClusterHealthDomainSummary[] = (
    Object.keys(DOMAIN_WEIGHTS) as HealthDomain[]
  ).map((domain) => {
    const domainRisks = risks.filter((risk) => risk.domain === domain);
    const penaltyRaw = domainRisks.reduce((total, risk) => total + risk.penalty, 0);
    const penalty = clamp(penaltyRaw, 0, DOMAIN_WEIGHTS[domain]);
    const score = clamp(DOMAIN_WEIGHTS[domain] - penalty, 0, DOMAIN_WEIGHTS[domain]);
    return {
      domain,
      label:
        domain === "controlPlane"
          ? "Control Plane"
          : domain === "platform"
            ? "Platform Hygiene"
            : domain.charAt(0).toUpperCase() + domain.slice(1),
      weight: DOMAIN_WEIGHTS[domain],
      score,
      penalty,
      risks: domainRisks,
    };
  });

  const score = domainSummaries.reduce((total, domain) => total + (domain.score ?? 0), 0);

  let status: ClusterHealthScoreStatus = "unknown";
  if (score >= 85) status = "healthy";
  else if (score >= 65) status = "degraded";
  else status = "unhealthy";

  const topRisks = [...risks].sort((a, b) => b.penalty - a.penalty).slice(0, 3);
  const topPenaltyByDomain = topRisks.reduce<Record<HealthDomain, number>>(
    (acc, risk) => {
      acc[risk.domain] = (acc[risk.domain] || 0) + risk.penalty;
      return acc;
    },
    {} as Record<HealthDomain, number>,
  );

  const nextScore = domainSummaries.reduce((total, domain) => {
    const rawPenalty = domain.risks.reduce((sum, risk) => sum + risk.penalty, 0);
    const updatedPenalty = clamp(
      rawPenalty - (topPenaltyByDomain[domain.domain] || 0),
      0,
      domain.weight,
    );
    return total + (domain.weight - updatedPenalty);
  }, 0);

  const scoreDelta = clamp(nextScore - score, 0, 100);

  return {
    score,
    status,
    statusLabel: getStatusLabel(status),
    domains: domainSummaries,
    risks,
    topRisks,
    scoreDelta,
  };
};
