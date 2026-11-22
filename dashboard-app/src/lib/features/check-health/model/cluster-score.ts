import type {
  ClusterHealthChecks,
  HpaCheckItem,
  NetworkIsolationItem,
  PodQosReport,
  PriorityHealthReport,
  ResourcesHygieneItem,
  ResourcesHygieneReport,
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

export type ClusterRuleStatus = "ok" | "warning" | "critical" | "unknown";

/**
 * One scoring rule with its outcome. Every rule is always present, so the UI can list
 * the ones that passed and the ones that could not run next to the ones that fired.
 */
export type ClusterRuleItem = {
  id: string;
  category: ScoreCategory;
  title: string;
  description: string;
  status: ClusterRuleStatus;
  statusLabel: string;
  reason: string;
  fix: string;
  penalty: number;
  references: string[];
};

export type ClusterScoreSummary = {
  score: number | null;
  status: ClusterScoreStatus;
  statusLabel: string;
  reliabilityScore: number | null;
  securityScore: number | null;
  reliabilityPenalty: number;
  securityPenalty: number;
  rules: ClusterRuleItem[];
  risks: ClusterRiskItem[];
  topRisks: ClusterRiskItem[];
  scoreDelta: number;
};

const MAX_CATEGORY_SCORE = 50;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const unique = (items: string[]) => [...new Set(items)];

const buildWorkloadKey = (namespace: string, workloadType: string, workload: string) =>
  `${namespace}/${workloadType}/${workload}`.toLowerCase();

const getBestEffortCount = (
  podQos?: PodQosReport | null,
  fallback?: ResourcesHygieneReport | null,
) => {
  if (podQos?.summary.bestEffort != null) return podQos.summary.bestEffort;
  return fallback?.summary.bestEffort ?? 0;
};

const collectBestEffortReferences = (
  podQos?: PodQosReport | null,
  fallback?: ResourcesHygieneReport | null,
) => {
  if (podQos?.summary.bestEffort != null) {
    return unique(
      podQos.items
        .filter((item) => item.qosClass === "BestEffort")
        .map((item) => `${item.namespace}/${item.pod}`),
    );
  }
  return unique(
    (fallback?.items ?? [])
      .filter((item) => item.qosClass === "BestEffort")
      .map((item) => `${item.namespace}/${item.workloadType}/${item.workload}`),
  );
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
  unique(items.map((item) => `${item.namespace}/${item.configMap}`));

const collectPriorityIssues = (report?: PriorityHealthReport | null) => {
  if (!report) return [];
  return report.items
    .filter((item) => item.status !== "ok")
    .map((item) => `${item.namespace}/${item.workload}`);
};

type RuleFinding = {
  severity: ClusterRiskItem["severity"];
  /** Overrides the rule title when the finding carries a count. */
  title?: string;
  reason: string;
  penalty: number;
  references: string[];
};

type RuleOutcome = { kind: "unknown" } | { kind: "ok" } | { kind: "finding"; finding: RuleFinding };

const UNKNOWN: RuleOutcome = { kind: "unknown" };
const OK: RuleOutcome = { kind: "ok" };
const finding = (value: RuleFinding): RuleOutcome => ({ kind: "finding", finding: value });

type RuleDefinition = {
  id: string;
  category: ScoreCategory;
  title: string;
  description: string;
  fix: string;
  evaluate: (checks: ClusterHealthChecks) => RuleOutcome;
};

/** A report is usable when it exists and its own status is not "unknown". */
const hasReport = (report: { status: string } | null | undefined): boolean =>
  report != null && report.status !== "unknown";

/**
 * Rules in scoring order. The order matters: top risks are sorted by penalty and ties
 * keep this order, so it must not change without a test.
 */
const RULES: RuleDefinition[] = [
  {
    id: "resources-missing",
    category: "reliability",
    title: "Missing resource requests/limits",
    description: "Every container declares CPU/memory requests and limits.",
    fix: "Add CPU/memory requests and limits to the affected workloads.",
    evaluate: (checks) => {
      const resources = checks.resourcesHygiene ?? null;
      if (!resources) return UNKNOWN;
      const missingSeverity = resources.summary.critical * 6 + resources.summary.warning * 3;
      if (missingSeverity <= 0) return hasReport(resources) ? OK : UNKNOWN;
      return finding({
        severity: resources.summary.critical > 0 ? "critical" : "warning",
        reason: "Scheduling and autoscaling signals are unreliable without requests/limits.",
        penalty: clamp(missingSeverity, 4, 15),
        references: unique(
          resources.items.map((item) => `${item.namespace}/${item.workloadType}/${item.workload}`),
        ),
      });
    },
  },
  {
    id: "best-effort",
    category: "reliability",
    title: "BestEffort pods",
    description: "No pod runs in the BestEffort QoS class.",
    fix: "Define CPU/memory requests to move pods to Burstable or Guaranteed QoS.",
    evaluate: (checks) => {
      const podQos = checks.podQos ?? null;
      const resources = checks.resourcesHygiene ?? null;
      const bestEffortCount = getBestEffortCount(podQos, resources);
      if (bestEffortCount <= 0) return hasReport(podQos) || hasReport(resources) ? OK : UNKNOWN;
      return finding({
        severity: "critical",
        title: `BestEffort pods (${bestEffortCount})`,
        reason: "BestEffort pods have no guarantees and are first to be evicted under pressure.",
        penalty: clamp(bestEffortCount * 5, 5, 20),
        references: collectBestEffortReferences(podQos, resources),
      });
    },
  },
  {
    id: "hpa-health",
    category: "reliability",
    title: "HPA misconfiguration or missing autoscaling",
    description: "HPAs have valid targets and metrics; workloads that need one have it.",
    fix: "Fix HPA targets/metrics and add HPAs for required workloads.",
    evaluate: (checks) => {
      const hpaStatus = checks.hpaStatus ?? null;
      if (!hpaStatus) return UNKNOWN;
      const hpaSeverity = hpaStatus.summary.critical * 6 + hpaStatus.summary.warning * 3;
      if (hpaSeverity <= 0) return hasReport(hpaStatus) ? OK : UNKNOWN;
      return finding({
        severity: hpaStatus.summary.critical > 0 ? "critical" : "warning",
        reason: "Autoscaling cannot stabilize workloads when HPA targets or metrics fail.",
        penalty: clamp(hpaSeverity, 5, 12),
        references: unique(hpaStatus.items.map((item) => `${item.namespace}/${item.workload}`)),
      });
    },
  },
  {
    id: "hpa-no-requests",
    category: "reliability",
    title: "HPA without resource requests",
    description: "Workloads scaled by a resource-based HPA declare CPU/memory requests.",
    fix: "Add CPU/memory requests for the HPA-managed workloads.",
    evaluate: (checks) => {
      const resources = checks.resourcesHygiene ?? null;
      const hpaStatus = checks.hpaStatus ?? null;
      if (!resources || !hpaStatus) return UNKNOWN;
      const missingRequests = collectMissingRequests(resources.items);
      const hpaTargets = collectHpaTargets(hpaStatus.items);
      const withoutRequests = Array.from(hpaTargets).filter((target) =>
        missingRequests.has(target),
      );
      if (!withoutRequests.length) {
        return hasReport(resources) && hasReport(hpaStatus) ? OK : UNKNOWN;
      }
      return finding({
        severity: "critical",
        reason: "Resource-based HPA needs requests to calculate utilization.",
        penalty: clamp(withoutRequests.length * 4, 8, 16),
        references: withoutRequests,
      });
    },
  },
  {
    id: "vpa-hpa-conflict",
    category: "reliability",
    title: "HPA and VPA Auto conflict",
    description: "No workload is managed by both an HPA and a VPA in Auto mode.",
    fix: "Switch VPA to Recommend/Initial or disable HPA for the same workload.",
    evaluate: (checks) => {
      const vpaStatus = checks.vpaStatus ?? null;
      if (!vpaStatus) return UNKNOWN;
      const conflicts = collectVpaConflicts(vpaStatus.items);
      if (!conflicts.length) return hasReport(vpaStatus) ? OK : UNKNOWN;
      return finding({
        severity: "warning",
        reason: "HPA and VPA Auto fight over replica and resource targets.",
        penalty: clamp(conflicts.length * 5, 10, 20),
        references: unique(conflicts.map((item) => `${item.namespace}/${item.workload}`)),
      });
    },
  },
  {
    id: "image-latest",
    category: "reliability",
    title: "Containers using :latest tag",
    description: "Container images are pinned to immutable digests or semver tags.",
    fix: "Pin images to immutable digests or semver tags.",
    evaluate: (checks) => {
      const imageFreshness = checks.imageFreshness ?? null;
      if (!imageFreshness) return UNKNOWN;
      const latestCount = imageFreshness.summary.latestTagCount;
      if (latestCount <= 0) return hasReport(imageFreshness) ? OK : UNKNOWN;
      return finding({
        severity: "warning",
        title: `Containers using :latest tag (${latestCount})`,
        reason: "Mutable tags make rollbacks unpredictable and break image caching.",
        penalty: clamp(latestCount * 2, 4, 12),
        references: [],
      });
    },
  },
  {
    id: "probes",
    category: "reliability",
    title: "Probe coverage gaps",
    description: "Workloads define readiness, liveness and startup probes.",
    fix: "Add readiness/liveness/startup probes with sane thresholds.",
    evaluate: (checks) => {
      const probes = checks.probesHealth ?? null;
      if (!probes) return UNKNOWN;
      const probeSeverity = probes.summary.critical * 5 + probes.summary.warning * 3;
      if (probeSeverity <= 0) return hasReport(probes) ? OK : UNKNOWN;
      return finding({
        severity: probes.summary.critical > 0 ? "critical" : "warning",
        reason: "Missing or broken probes delay recovery and hide failures.",
        penalty: clamp(probeSeverity, 4, 12),
        references: unique(probes.items.map((item) => `${item.namespace}/${item.workload}`)),
      });
    },
  },
  {
    id: "topology",
    category: "reliability",
    title: "Missing topology spread for HA workloads",
    description: "Workloads with 2+ replicas spread them with constraints or anti-affinity.",
    fix: "Add topology spread constraints or pod anti-affinity for replicas >= 2.",
    evaluate: (checks) => {
      const topology = checks.topologyHa ?? null;
      if (!topology) return UNKNOWN;
      const topologyRisks = collectTopologyRisks(topology.items);
      if (!topologyRisks.length) return hasReport(topology) ? OK : UNKNOWN;
      return finding({
        severity: "warning",
        reason: "Replica placement without spread increases correlated failures.",
        penalty: clamp(topologyRisks.length * 3, 6, 15),
        references: unique(topologyRisks.map((item) => `${item.namespace}/${item.workload}`)),
      });
    },
  },
  {
    id: "pdb",
    category: "reliability",
    title: "Missing or unsafe PodDisruptionBudgets",
    description: "Stateful and critical workloads have a PodDisruptionBudget that allows drains.",
    fix: "Add PDBs for stateful or critical workloads.",
    evaluate: (checks) => {
      const pdb = checks.pdbStatus ?? null;
      if (!pdb) return UNKNOWN;
      const pdbIssues = pdb.items.filter((item) => item.status !== "ok");
      if (!pdbIssues.length) return hasReport(pdb) ? OK : UNKNOWN;
      const singleReplica = pdbIssues.filter((item) => item.replicas <= 1);
      return finding({
        severity: pdbIssues.some((item) => item.status === "critical") ? "critical" : "warning",
        reason: singleReplica.length
          ? "Single-replica workloads without PDBs break during node drain."
          : "No PDB means voluntary disruption can cause downtime.",
        penalty: clamp(pdbIssues.length * 4, 8, 16),
        references: unique(pdbIssues.map((item) => `${item.namespace}/${item.workload}`)),
      });
    },
  },
  {
    id: "psa",
    category: "security",
    title: "PSA/PSS compliance gaps",
    description: "Pods comply with the Pod Security Standard enforced on their namespace.",
    fix: "Align namespaces with PSA levels and remove privileged settings.",
    evaluate: (checks) => {
      const podSecurity = checks.podSecurity ?? null;
      if (!podSecurity) return UNKNOWN;
      const psaSeverity = podSecurity.summary.critical * 6 + podSecurity.summary.warning * 3;
      if (psaSeverity <= 0) return hasReport(podSecurity) ? OK : UNKNOWN;
      return finding({
        severity: podSecurity.summary.critical > 0 ? "critical" : "warning",
        reason: "Privileged settings bypass baseline security controls.",
        penalty: clamp(psaSeverity, 6, 15),
        references: unique(podSecurity.items.map((item) => `${item.namespace}/${item.pod}`)),
      });
    },
  },
  {
    id: "security-hardening",
    category: "security",
    title: "SecurityContext hardening missing",
    description:
      "Containers run as non-root, with a read-only root filesystem and dropped capabilities.",
    fix: "Set runAsNonRoot, readOnlyRootFilesystem, and drop capabilities.",
    evaluate: (checks) => {
      const securityHardening = checks.securityHardening ?? null;
      if (!securityHardening) return UNKNOWN;
      const hardeningSeverity =
        securityHardening.summary.critical * 5 + securityHardening.summary.warning * 3;
      if (hardeningSeverity <= 0) return hasReport(securityHardening) ? OK : UNKNOWN;
      return finding({
        severity: securityHardening.summary.critical > 0 ? "critical" : "warning",
        reason: "Containers run with elevated permissions or writable filesystems.",
        penalty: clamp(hardeningSeverity, 5, 12),
        references: unique(
          securityHardening.items.map(
            (item) => `${item.namespace}/${item.workloadType}/${item.workload}`,
          ),
        ),
      });
    },
  },
  {
    id: "network-policy",
    category: "security",
    title: "NetworkPolicy baseline missing",
    description: "Every namespace has a default-deny NetworkPolicy with explicit allows.",
    fix: "Add default-deny policies and allow only required ingress/egress.",
    evaluate: (checks) => {
      const networkIsolation = checks.networkIsolation ?? null;
      if (!networkIsolation) return UNKNOWN;
      const isolationSeverity =
        networkIsolation.summary.critical * 6 + networkIsolation.summary.warning * 3;
      if (isolationSeverity <= 0) return hasReport(networkIsolation) ? OK : UNKNOWN;
      return finding({
        severity: networkIsolation.summary.critical > 0 ? "critical" : "warning",
        reason: "Namespaces without default-deny allow lateral movement.",
        penalty: clamp(isolationSeverity, 6, 15),
        references: unique(collectNetworkNamespaces(networkIsolation.items)),
      });
    },
  },
  {
    id: "secrets",
    category: "security",
    title: "Secrets exposed via ConfigMaps",
    description: "ConfigMaps hold no secret-like values (tokens, passwords, keys).",
    fix: "Move sensitive keys to Secrets and enable encryption at rest.",
    evaluate: (checks) => {
      const secrets = checks.secretsHygiene ?? null;
      if (!secrets) return UNKNOWN;
      const secretSeverity = secrets.summary.critical * 7 + secrets.summary.warning * 4;
      if (secretSeverity <= 0) return hasReport(secrets) ? OK : UNKNOWN;
      return finding({
        severity: secrets.summary.critical > 0 ? "critical" : "warning",
        reason: "Sensitive data in ConfigMaps is unencrypted and widely readable.",
        penalty: clamp(secretSeverity, 10, 20),
        references: collectSecrets(secrets.items),
      });
    },
  },
  {
    id: "priority",
    category: "security",
    title: "PriorityClass & preemption gaps",
    description: "Critical workloads carry a PriorityClass so they survive eviction pressure.",
    fix: "Assign PriorityClasses and tune preemption for critical services.",
    evaluate: (checks) => {
      const priority = checks.priorityStatus ?? null;
      if (!priority) return UNKNOWN;
      const prioritySeverity = priority.summary.critical * 4 + priority.summary.warning * 2;
      if (prioritySeverity <= 0) return hasReport(priority) ? OK : UNKNOWN;
      return finding({
        severity: priority.summary.critical > 0 ? "critical" : "warning",
        reason: "Critical workloads can be evicted without priority protection.",
        penalty: clamp(prioritySeverity, 4, 10),
        references: unique(collectPriorityIssues(priority)),
      });
    },
  },
  {
    id: "rbac-overprivileged",
    category: "security",
    title: "Overprivileged RBAC bindings",
    description: "No non-system ServiceAccount is bound to cluster-admin.",
    fix: "Replace cluster-admin bindings with scoped Roles/ClusterRoles.",
    evaluate: (checks) => {
      const rbacOverview = checks.rbacOverview ?? null;
      if (!rbacOverview) return UNKNOWN;
      const count = rbacOverview.summary.overprivilegedCount;
      if (count <= 0) return hasReport(rbacOverview) ? OK : UNKNOWN;
      return finding({
        severity: "warning",
        title: `Overprivileged RBAC bindings (${count})`,
        reason: "Non-system ServiceAccounts bound to cluster-admin increase blast radius.",
        penalty: clamp(count * 4, 6, 15),
        references: [],
      });
    },
  },
  {
    id: "ingress-no-tls",
    category: "security",
    title: "Ingress without TLS",
    description: "Every Ingress terminates TLS.",
    fix: "Configure TLS certificates for all public-facing ingress routes.",
    evaluate: (checks) => {
      const ingressStatus = checks.ingressStatus ?? null;
      if (!ingressStatus) return UNKNOWN;
      const noTls = ingressStatus.summary.withoutTls;
      if (noTls <= 0) return hasReport(ingressStatus) ? OK : UNKNOWN;
      return finding({
        severity: "warning",
        title: `Ingress without TLS (${noTls})`,
        reason: "Unencrypted ingress routes expose traffic to interception.",
        penalty: clamp(noTls * 3, 4, 10),
        references: unique(
          ingressStatus.items
            .filter((item) => !item.hasTls)
            .map((item) => `${item.namespace}/${item.name}`),
        ),
      });
    },
  },
];

const RULE_STATUS_LABELS: Record<ClusterRuleStatus, string> = {
  ok: "OK",
  warning: "Warning",
  critical: "Critical",
  unknown: "Not checked",
};

const toRule = (rule: RuleDefinition, outcome: RuleOutcome): ClusterRuleItem => {
  const status: ClusterRuleStatus =
    outcome.kind === "finding" ? outcome.finding.severity : outcome.kind;
  return {
    id: rule.id,
    category: rule.category,
    title: outcome.kind === "finding" ? (outcome.finding.title ?? rule.title) : rule.title,
    description: rule.description,
    status,
    statusLabel: RULE_STATUS_LABELS[status],
    reason: outcome.kind === "finding" ? outcome.finding.reason : "",
    fix: rule.fix,
    penalty: outcome.kind === "finding" ? clamp(outcome.finding.penalty, 1, MAX_CATEGORY_SCORE) : 0,
    references: outcome.kind === "finding" ? outcome.finding.references : [],
  };
};

const toRisk = (rule: ClusterRuleItem): ClusterRiskItem | null => {
  if (rule.status !== "warning" && rule.status !== "critical") return null;
  return {
    id: rule.id,
    category: rule.category,
    severity: rule.status,
    title: rule.title,
    reason: rule.reason,
    fix: rule.fix,
    penalty: rule.penalty,
    references: rule.references,
  };
};

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
      rules: RULES.map((rule) => toRule(rule, UNKNOWN)),
      risks: [],
      topRisks: [],
      scoreDelta: 0,
    };
  }

  const rules = RULES.map((rule) => toRule(rule, rule.evaluate(checks)));
  const risks = rules.map(toRisk).filter((risk): risk is ClusterRiskItem => risk !== null);

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

  return {
    score,
    status,
    statusLabel: getStatusLabel(status),
    reliabilityScore,
    securityScore,
    reliabilityPenalty,
    securityPenalty,
    rules,
    risks,
    topRisks,
    scoreDelta,
  };
};
