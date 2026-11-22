import type {
  ClusterHealthChecks,
  HpaCheckItem,
  NetworkIsolationItem,
  PodQosReport,
  PriorityHealthReport,
  ResourcesHygieneItem,
  SecretsHygieneItem,
  TopologyHaItem,
  VpaHealthItem,
} from "./types";

type ScoreCategory = "reliability" | "security";

export type ClusterScoreStatus = "healthy" | "at-risk" | "unsafe" | "unknown";

export type ClusterRiskItem = {
  id: string;
  category: ScoreCategory;
  severity: "warning" | "critical";
  title: string;
  reason: string;
  fix: string;
  penalty: number;
  references: string[];
};

export type ClusterRuleId =
  | "resources-missing"
  | "best-effort"
  | "hpa-health"
  | "hpa-no-requests"
  | "vpa-hpa-conflict"
  | "image-latest"
  | "probes"
  | "topology"
  | "pdb"
  | "psa"
  | "security-hardening"
  | "network-policy"
  | "secrets"
  | "priority"
  | "rbac-overprivileged"
  | "ingress-no-tls";

// "not-checked": the check behind the rule has not run, or could not read the cluster.
export type ClusterRuleStatus = "fail" | "pass" | "not-checked";

export type ClusterRuleResult = {
  id: ClusterRuleId;
  category: ScoreCategory;
  title: string;
  status: ClusterRuleStatus;
  risk: ClusterRiskItem | null;
};

// Every rule the score is built from, in display order. A rule without a risk is shown as
// passed only when its check produced a usable report.
export const CLUSTER_SCORE_RULES: ReadonlyArray<{
  id: ClusterRuleId;
  category: ScoreCategory;
  title: string;
}> = [
  { id: "resources-missing", category: "reliability", title: "Resource requests and limits" },
  { id: "best-effort", category: "reliability", title: "No BestEffort pods" },
  { id: "hpa-health", category: "reliability", title: "HPA targets and metrics" },
  { id: "hpa-no-requests", category: "reliability", title: "HPA targets have requests" },
  { id: "vpa-hpa-conflict", category: "reliability", title: "No HPA and VPA Auto conflict" },
  { id: "image-latest", category: "reliability", title: "No :latest image tags" },
  { id: "probes", category: "reliability", title: "Probe coverage" },
  { id: "topology", category: "reliability", title: "Topology spread for HA workloads" },
  { id: "pdb", category: "reliability", title: "PodDisruptionBudgets" },
  { id: "psa", category: "security", title: "PSA/PSS compliance" },
  { id: "security-hardening", category: "security", title: "SecurityContext hardening" },
  { id: "network-policy", category: "security", title: "NetworkPolicy baseline" },
  { id: "secrets", category: "security", title: "No secrets in ConfigMaps" },
  { id: "priority", category: "security", title: "PriorityClass for critical workloads" },
  { id: "rbac-overprivileged", category: "security", title: "No overprivileged RBAC bindings" },
  { id: "ingress-no-tls", category: "security", title: "Ingress TLS" },
];

export type ClusterScoreSummary = {
  score: number | null;
  status: ClusterScoreStatus;
  statusLabel: string;
  reliabilityScore: number | null;
  securityScore: number | null;
  reliabilityPenalty: number;
  securityPenalty: number;
  risks: ClusterRiskItem[];
  topRisks: ClusterRiskItem[];
  scoreDelta: number;
  rules: ClusterRuleResult[];
};

const MAX_CATEGORY_SCORE = 50;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildWorkloadKey = (namespace: string, workloadType: string, workload: string) =>
  `${namespace}/${workloadType}/${workload}`.toLowerCase();

const getBestEffortCount = (
  podQos?: PodQosReport | null,
  fallback?: ClusterHealthChecks["resourcesHygiene"] | null,
) => {
  if (podQos?.summary.bestEffort != null) return podQos.summary.bestEffort;
  return fallback?.summary.bestEffort ?? 0;
};

const collectMissingRequests = (items: ResourcesHygieneItem[]) => {
  const missingRequests = new Map<string, string[]>();
  items.forEach((item) => {
    const missing = item.missing.filter((label) =>
      ["cpu request", "memory request"].includes(label.toLowerCase()),
    );
    if (!missing.length) return;
    const key = buildWorkloadKey(item.namespace, item.workloadType, item.workload);
    const entry = missingRequests.get(key) ?? [];
    missingRequests.set(key, [...new Set([...entry, ...missing])]);
  });
  return missingRequests;
};

const collectHpaTargets = (items: HpaCheckItem[]) => {
  const targets = new Set<string>();
  items.forEach((item) => {
    if (!item.workload) return;
    targets.add(buildWorkloadKey(item.namespace, item.workloadType, item.workload));
  });
  return targets;
};

const collectVpaConflicts = (items: VpaHealthItem[]) =>
  items.filter((item) => item.updateMode === "Auto" && item.hpaPresent);

const collectTopologyRisks = (items: TopologyHaItem[]) =>
  items.filter((item) => item.replicas >= 2 && item.status !== "ok");

const collectNetworkNamespaces = (items: NetworkIsolationItem[]) =>
  items.filter((item) => item.status !== "ok").map((item) => item.namespace);

const collectSecrets = (items: SecretsHygieneItem[]) =>
  items.map((item) => `${item.namespace}/${item.configMap}`);

const collectPriorityIssues = (report?: PriorityHealthReport | null) => {
  if (!report) return [];
  return report.items
    .filter((item) => item.status !== "ok")
    .map((item) => `${item.namespace}/${item.workload}`);
};

// Report states that mean the check could not judge the cluster.
const UNUSABLE_REPORT_STATUSES = new Set(["unreachable", "insufficient", "unsupported", "unknown"]);

const isUsable = (report: { status?: unknown } | null | undefined) =>
  report != null && !UNUSABLE_REPORT_STATUSES.has(String(report.status));

// References name the flagged objects only, not every object the check looked at.
const isFlagged = (item: { status?: unknown }) =>
  item.status === "warning" || item.status === "critical";

type ResourcesHygieneWorkloads = NonNullable<ClusterHealthChecks["resourcesHygiene"]>["workloads"];

// Synthetic fleet and fixture reports carry summary and items only; the workload list is
// optional there, and a report without it names nothing.
const listWorkloads = (report: { workloads?: ResourcesHygieneWorkloads }) => report.workloads ?? [];

// Per-container items repeat the same pod or workload; each object is named once.
const createRisk = (risk: Omit<ClusterRiskItem, "penalty"> & { penalty: number }) => ({
  ...risk,
  penalty: clamp(risk.penalty, 1, MAX_CATEGORY_SCORE),
  references: [...new Set(risk.references)],
});

const getStatusLabel = (status: ClusterScoreStatus) => {
  if (status === "healthy") return "Healthy";
  if (status === "at-risk") return "At Risk";
  if (status === "unsafe") return "Unsafe";
  return "Unknown";
};

export const buildClusterScore = (checks: ClusterHealthChecks | null): ClusterScoreSummary => {
  if (!checks) {
    return {
      score: null,
      status: "unknown",
      statusLabel: getStatusLabel("unknown"),
      reliabilityScore: null,
      securityScore: null,
      reliabilityPenalty: 0,
      securityPenalty: 0,
      risks: [],
      topRisks: [],
      scoreDelta: 0,
      rules: CLUSTER_SCORE_RULES.map((rule) => ({ ...rule, status: "not-checked", risk: null })),
    };
  }

  const risks: ClusterRiskItem[] = [];

  const resources = checks.resourcesHygiene ?? null;
  const hpaStatus = checks.hpaStatus ?? null;
  const probes = checks.probesHealth ?? null;
  const podQos = checks.podQos ?? null;
  const vpaStatus = checks.vpaStatus ?? null;
  const topology = checks.topologyHa ?? null;
  const pdb = checks.pdbStatus ?? null;
  const podSecurity = checks.podSecurity ?? null;
  const networkIsolation = checks.networkIsolation ?? null;
  const secrets = checks.secretsHygiene ?? null;
  const priority = checks.priorityStatus ?? null;
  const securityHardening = checks.securityHardening ?? null;

  if (resources?.summary) {
    const missingSeverity = resources.summary.critical * 6 + resources.summary.warning * 3;
    if (missingSeverity > 0) {
      risks.push(
        createRisk({
          id: "resources-missing",
          category: "reliability",
          severity: resources.summary.critical > 0 ? "critical" : "warning",
          title: "Missing resource requests/limits",
          reason: "Scheduling and autoscaling signals are unreliable without requests/limits.",
          fix: "Add CPU/memory requests and limits to the affected workloads.",
          penalty: clamp(missingSeverity, 4, 15),
          // Items also list containers that only lack a CPU limit (optional), so an ok
          // workload would be named; the per-workload status is the verdict.
          references: listWorkloads(resources)
            .filter(isFlagged)
            .map((item) => `${item.namespace}/${item.workloadType}/${item.workload}`),
        }),
      );
    }
  }

  const bestEffortCount = getBestEffortCount(podQos, resources);
  if (bestEffortCount > 0) {
    risks.push(
      createRisk({
        id: "best-effort",
        category: "reliability",
        severity: "critical",
        title: `BestEffort pods (${bestEffortCount})`,
        reason: "BestEffort pods have no guarantees and are first to be evicted under pressure.",
        fix: "Define CPU/memory requests to move pods to Burstable or Guaranteed QoS.",
        penalty: clamp(bestEffortCount * 5, 5, 20),
        references: podQos?.items
          ? podQos.items
              .filter((item) => item.qosClass === "BestEffort")
              .map((item) => `${item.namespace}/${item.pod}`)
          : (resources?.items ?? [])
              .filter((item) => item.qosClass === "BestEffort")
              .map((item) => `${item.namespace}/${item.workloadType}/${item.workload}`),
      }),
    );
  }

  if (hpaStatus?.summary) {
    const hpaSeverity = hpaStatus.summary.critical * 6 + hpaStatus.summary.warning * 3;
    if (hpaSeverity > 0) {
      risks.push(
        createRisk({
          id: "hpa-health",
          category: "reliability",
          severity: hpaStatus.summary.critical > 0 ? "critical" : "warning",
          title: "HPA misconfiguration or missing autoscaling",
          reason: "Autoscaling cannot stabilize workloads when HPA targets or metrics fail.",
          fix: "Fix HPA targets/metrics and add HPAs for required workloads.",
          penalty: clamp(hpaSeverity, 5, 12),
          references: hpaStatus.items
            .filter(isFlagged)
            .map((item) => `${item.namespace}/${item.workload}`),
        }),
      );
    }
  }

  if (resources && hpaStatus?.items) {
    const missingRequests = collectMissingRequests(resources.items);
    const hpaTargets = collectHpaTargets(hpaStatus.items);
    const withoutRequests = Array.from(hpaTargets).filter((target) => missingRequests.has(target));
    if (withoutRequests.length) {
      risks.push(
        createRisk({
          id: "hpa-no-requests",
          category: "reliability",
          severity: "critical",
          title: "HPA without resource requests",
          reason: "Resource-based HPA needs requests to calculate utilization.",
          fix: "Add CPU/memory requests for the HPA-managed workloads.",
          penalty: clamp(withoutRequests.length * 4, 8, 16),
          references: withoutRequests,
        }),
      );
    }
  }

  if (vpaStatus?.items) {
    const conflicts = collectVpaConflicts(vpaStatus.items);
    if (conflicts.length) {
      risks.push(
        createRisk({
          id: "vpa-hpa-conflict",
          category: "reliability",
          severity: "warning",
          title: "HPA and VPA Auto conflict",
          reason: "HPA and VPA Auto fight over replica and resource targets.",
          fix: "Switch VPA to Recommend/Initial or disable HPA for the same workload.",
          penalty: clamp(conflicts.length * 5, 10, 20),
          references: conflicts.map((item) => `${item.namespace}/${item.workload}`),
        }),
      );
    }
  }

  const imageFreshness = (checks as Record<string, unknown>).imageFreshness as
    | { status?: string; summary?: { latestTagCount?: number } }
    | undefined;
  if (imageFreshness?.summary && (imageFreshness.summary.latestTagCount ?? 0) > 0) {
    const latestCount = imageFreshness.summary.latestTagCount ?? 0;
    risks.push(
      createRisk({
        id: "image-latest",
        category: "reliability",
        severity: "warning",
        title: `Containers using :latest tag (${latestCount})`,
        reason: "Mutable tags make rollbacks unpredictable and break image caching.",
        fix: "Pin images to immutable digests or semver tags.",
        penalty: clamp(latestCount * 2, 4, 12),
        references: [],
      }),
    );
  }

  if (probes?.summary) {
    const probeSeverity = probes.summary.critical * 5 + probes.summary.warning * 3;
    if (probeSeverity > 0) {
      risks.push(
        createRisk({
          id: "probes",
          category: "reliability",
          severity: probes.summary.critical > 0 ? "critical" : "warning",
          title: "Probe coverage gaps",
          reason: "Missing or broken probes delay recovery and hide failures.",
          fix: "Add readiness/liveness/startup probes with sane thresholds.",
          penalty: clamp(probeSeverity, 4, 12),
          references: probes.items
            .filter(isFlagged)
            .map((item) => `${item.namespace}/${item.workload}`),
        }),
      );
    }
  }

  if (topology?.items) {
    const topologyRisks = collectTopologyRisks(topology.items);
    if (topologyRisks.length) {
      risks.push(
        createRisk({
          id: "topology",
          category: "reliability",
          severity: "warning",
          title: "Missing topology spread for HA workloads",
          reason: "Replica placement without spread increases correlated failures.",
          fix: "Add topology spread constraints or pod anti-affinity for replicas >= 2.",
          penalty: clamp(topologyRisks.length * 3, 6, 15),
          references: topologyRisks.map((item) => `${item.namespace}/${item.workload}`),
        }),
      );
    }
  }

  if (pdb?.items) {
    const pdbIssues = pdb.items.filter((item) => item.status !== "ok");
    const singleReplica = pdbIssues.filter((item) => item.replicas <= 1);
    if (pdbIssues.length) {
      risks.push(
        createRisk({
          id: "pdb",
          category: "reliability",
          severity: pdbIssues.some((item) => item.status === "critical") ? "critical" : "warning",
          title: "Missing or unsafe PodDisruptionBudgets",
          reason: singleReplica.length
            ? "Single-replica workloads without PDBs break during node drain."
            : "No PDB means voluntary disruption can cause downtime.",
          fix: singleReplica.length
            ? "Increase replicas or add a PDB with minAvailable=1."
            : "Add PDBs for stateful or critical workloads.",
          penalty: clamp(pdbIssues.length * 4, 8, 16),
          references: pdbIssues.map((item) => `${item.namespace}/${item.workload}`),
        }),
      );
    }
  }

  if (podSecurity?.summary) {
    const psaSeverity = podSecurity.summary.critical * 6 + podSecurity.summary.warning * 3;
    if (psaSeverity > 0) {
      risks.push(
        createRisk({
          id: "psa",
          category: "security",
          severity: podSecurity.summary.critical > 0 ? "critical" : "warning",
          title: "PSA/PSS compliance gaps",
          reason: "Privileged settings bypass baseline security controls.",
          fix: "Align namespaces with PSA levels and remove privileged settings.",
          penalty: clamp(psaSeverity, 6, 15),
          references: podSecurity.items
            .filter(isFlagged)
            .map((item) => `${item.namespace}/${item.pod}`),
        }),
      );
    }
  }

  if (securityHardening?.summary) {
    const hardeningSeverity =
      securityHardening.summary.critical * 5 + securityHardening.summary.warning * 3;
    if (hardeningSeverity > 0) {
      risks.push(
        createRisk({
          id: "security-hardening",
          category: "security",
          severity: securityHardening.summary.critical > 0 ? "critical" : "warning",
          title: "SecurityContext hardening missing",
          reason: "Containers run with elevated permissions or writable filesystems.",
          fix: "Set runAsNonRoot, readOnlyRootFilesystem, and drop capabilities.",
          penalty: clamp(hardeningSeverity, 5, 12),
          references: securityHardening.items
            .filter(isFlagged)
            .map((item) => `${item.namespace}/${item.workloadType}/${item.workload}`),
        }),
      );
    }
  }

  if (networkIsolation?.summary) {
    const isolationSeverity =
      networkIsolation.summary.critical * 6 + networkIsolation.summary.warning * 3;
    const namespaces = collectNetworkNamespaces(networkIsolation.items);
    if (isolationSeverity > 0) {
      risks.push(
        createRisk({
          id: "network-policy",
          category: "security",
          severity: networkIsolation.summary.critical > 0 ? "critical" : "warning",
          title: "NetworkPolicy baseline missing",
          reason: "Namespaces without default-deny allow lateral movement.",
          fix: "Add default-deny policies and allow only required ingress/egress.",
          penalty: clamp(isolationSeverity, 6, 15),
          references: namespaces,
        }),
      );
    }
  }

  if (secrets?.summary) {
    const secretSeverity = secrets.summary.critical * 7 + secrets.summary.warning * 4;
    if (secretSeverity > 0) {
      risks.push(
        createRisk({
          id: "secrets",
          category: "security",
          severity: secrets.summary.critical > 0 ? "critical" : "warning",
          title: "Secrets exposed via ConfigMaps",
          reason: "Sensitive data in ConfigMaps is unencrypted and widely readable.",
          fix: "Move sensitive keys to Secrets and enable encryption at rest.",
          penalty: clamp(secretSeverity, 10, 20),
          references: collectSecrets(secrets.items),
        }),
      );
    }
  }

  if (priority?.summary) {
    const prioritySeverity = priority.summary.critical * 4 + priority.summary.warning * 2;
    if (prioritySeverity > 0) {
      risks.push(
        createRisk({
          id: "priority",
          category: "security",
          severity: priority.summary.critical > 0 ? "critical" : "warning",
          title: "PriorityClass & preemption gaps",
          reason: "Critical workloads can be evicted without priority protection.",
          fix: "Assign PriorityClasses and tune preemption for critical services.",
          penalty: clamp(prioritySeverity, 4, 10),
          references: collectPriorityIssues(priority),
        }),
      );
    }
  }

  const rbacOverview = (checks as Record<string, unknown>).rbacOverview as
    | { status?: string; summary?: { overprivilegedCount?: number } }
    | undefined;
  if (rbacOverview?.summary && (rbacOverview.summary.overprivilegedCount ?? 0) > 0) {
    const count = rbacOverview.summary.overprivilegedCount ?? 0;
    risks.push(
      createRisk({
        id: "rbac-overprivileged",
        category: "security",
        severity: "warning",
        title: `Overprivileged RBAC bindings (${count})`,
        reason: "Non-system ServiceAccounts bound to cluster-admin increase blast radius.",
        fix: "Replace cluster-admin bindings with scoped Roles/ClusterRoles.",
        penalty: clamp(count * 4, 6, 15),
        references: [],
      }),
    );
  }

  const ingressStatus = (checks as Record<string, unknown>).ingressStatus as
    | {
        status?: string;
        summary?: { withoutTls?: number; total?: number };
        items?: Array<{ namespace: string; name: string; hasTls: boolean }>;
      }
    | undefined;
  if (ingressStatus?.summary && (ingressStatus.summary.withoutTls ?? 0) > 0) {
    const noTls = ingressStatus.summary.withoutTls ?? 0;
    risks.push(
      createRisk({
        id: "ingress-no-tls",
        category: "security",
        severity: "warning",
        title: `Ingress without TLS (${noTls})`,
        reason: "Unencrypted ingress routes expose traffic to interception.",
        fix: "Configure TLS certificates for all public-facing ingress routes.",
        penalty: clamp(noTls * 3, 4, 10),
        references: (ingressStatus.items ?? [])
          .filter((item) => !item.hasTls)
          .map((item) => `${item.namespace}/${item.name}`),
      }),
    );
  }

  const reliabilityPenaltyRaw = risks
    .filter((risk) => risk.category === "reliability")
    .reduce((total, risk) => total + risk.penalty, 0);
  const securityPenaltyRaw = risks
    .filter((risk) => risk.category === "security")
    .reduce((total, risk) => total + risk.penalty, 0);
  const reliabilityPenalty = clamp(reliabilityPenaltyRaw, 0, MAX_CATEGORY_SCORE);
  const securityPenalty = clamp(securityPenaltyRaw, 0, MAX_CATEGORY_SCORE);

  const reliabilityScore = clamp(MAX_CATEGORY_SCORE - reliabilityPenalty, 0, MAX_CATEGORY_SCORE);
  const securityScore = clamp(MAX_CATEGORY_SCORE - securityPenalty, 0, MAX_CATEGORY_SCORE);
  const score = clamp(reliabilityScore + securityScore, 0, MAX_CATEGORY_SCORE * 2);

  let status: ClusterScoreStatus = "unknown";
  if (score >= 85) status = "healthy";
  else if (score >= 60) status = "at-risk";
  else status = "unsafe";

  const topRisks = [...risks].sort((a, b) => b.penalty - a.penalty).slice(0, 3);
  const topReliabilityPenalty = topRisks
    .filter((risk) => risk.category === "reliability")
    .reduce((total, risk) => total + risk.penalty, 0);
  const topSecurityPenalty = topRisks
    .filter((risk) => risk.category === "security")
    .reduce((total, risk) => total + risk.penalty, 0);
  const nextReliabilityPenalty = clamp(
    reliabilityPenaltyRaw - topReliabilityPenalty,
    0,
    MAX_CATEGORY_SCORE,
  );
  const nextSecurityPenalty = clamp(securityPenaltyRaw - topSecurityPenalty, 0, MAX_CATEGORY_SCORE);
  const nextScore = clamp(
    MAX_CATEGORY_SCORE * 2 - (nextReliabilityPenalty + nextSecurityPenalty),
    0,
    MAX_CATEGORY_SCORE * 2,
  );
  const scoreDelta = clamp(nextScore - score, 0, MAX_CATEGORY_SCORE * 2);

  const checked: Record<ClusterRuleId, boolean> = {
    "resources-missing": isUsable(resources),
    "best-effort": isUsable(podQos) || isUsable(resources),
    "hpa-health": isUsable(hpaStatus),
    "hpa-no-requests": isUsable(resources) && isUsable(hpaStatus),
    "vpa-hpa-conflict": isUsable(vpaStatus),
    "image-latest": isUsable(imageFreshness),
    probes: isUsable(probes),
    topology: isUsable(topology),
    pdb: isUsable(pdb),
    psa: isUsable(podSecurity),
    "security-hardening": isUsable(securityHardening),
    "network-policy": isUsable(networkIsolation),
    secrets: isUsable(secrets),
    priority: isUsable(priority),
    "rbac-overprivileged": isUsable(rbacOverview),
    "ingress-no-tls": isUsable(ingressStatus),
  };
  const rules: ClusterRuleResult[] = CLUSTER_SCORE_RULES.map((rule) => {
    const risk = risks.find((item) => item.id === rule.id) ?? null;
    const ruleStatus: ClusterRuleStatus = risk ? "fail" : checked[rule.id] ? "pass" : "not-checked";
    return { ...rule, status: ruleStatus, risk };
  });

  return {
    score,
    status,
    statusLabel: getStatusLabel(status),
    reliabilityScore,
    securityScore,
    reliabilityPenalty,
    securityPenalty,
    risks,
    topRisks,
    scoreDelta,
    rules,
  };
};
