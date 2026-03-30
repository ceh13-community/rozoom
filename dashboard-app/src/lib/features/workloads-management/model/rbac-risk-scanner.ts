/**
 * RBAC least-privilege risk scanner.
 *
 * Based on: https://kubernetes.io/docs/concepts/security/rbac-good-practices/
 *
 * Flags dangerous verb+resource combinations:
 *   CRITICAL: wildcard verbs/resources, escalate, bind, impersonate, nodes/proxy
 *   HIGH: secrets list/watch, pods/exec create, PV create, SA token create
 *   MEDIUM: pods create (implicit secret access), namespace update
 */

export type RbacRiskLevel = "critical" | "high" | "medium" | "low";

export type RbacRiskFinding = {
  level: RbacRiskLevel;
  rule: string;
  description: string;
  apiGroup: string;
  resource: string;
  verbs: string[];
};

export type RbacRoleRisk = {
  name: string;
  namespace: string | null;
  kind: "Role" | "ClusterRole";
  findings: RbacRiskFinding[];
  riskScore: number;
  highestRisk: RbacRiskLevel;
};

export type RbacRiskReport = {
  roles: RbacRoleRisk[];
  summary: {
    totalRoles: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    cleanCount: number;
  };
};

type RuleInput = {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
};

type RoleInput = {
  name: string;
  namespace: string | null;
  kind: "Role" | "ClusterRole";
  rules: RuleInput[];
};

type RiskPattern = {
  rule: string;
  description: string;
  level: RbacRiskLevel;
  match: (r: RuleInput) => boolean;
};

const RISK_PATTERNS: RiskPattern[] = [
  {
    rule: "wildcard-all",
    description:
      "Wildcard verbs on wildcard resources grants unrestricted access to all current and future resource types",
    level: "critical",
    match: (r) => r.verbs.includes("*") && r.resources.includes("*"),
  },
  {
    rule: "wildcard-resources",
    description: "Wildcard resources grants access to all current and future resource types",
    level: "critical",
    match: (r) => r.resources.includes("*") && !r.verbs.includes("*"),
  },
  {
    rule: "escalate-roles",
    description:
      "Escalate verb on roles allows creating roles with higher privileges than the user has",
    level: "critical",
    match: (r) =>
      r.verbs.includes("escalate") &&
      (r.resources.includes("roles") || r.resources.includes("clusterroles")),
  },
  {
    rule: "bind-rolebindings",
    description:
      "Bind verb on rolebindings allows binding elevated roles to any user or service account",
    level: "critical",
    match: (r) =>
      r.verbs.includes("bind") &&
      (r.resources.includes("rolebindings") || r.resources.includes("clusterrolebindings")),
  },
  {
    rule: "impersonate-users",
    description: "Impersonate verb allows acting as any user including cluster-admin",
    level: "critical",
    match: (r) => r.verbs.includes("impersonate"),
  },
  {
    rule: "nodes-proxy",
    description:
      "Access to nodes/proxy enables direct Kubelet API calls, bypassing audit logging and admission control",
    level: "critical",
    match: (r) => r.resources.includes("nodes/proxy"),
  },
  {
    rule: "secrets-list-watch",
    description:
      "List/watch on secrets reveals all secret contents in responses, not just metadata",
    level: "high",
    match: (r) =>
      r.resources.includes("secrets") && (r.verbs.includes("list") || r.verbs.includes("watch")),
  },
  {
    rule: "pods-exec",
    description: "Create pods/exec allows executing arbitrary commands in containers",
    level: "high",
    match: (r) => r.resources.includes("pods/exec") && r.verbs.includes("create"),
  },
  {
    rule: "pv-create",
    description:
      "Creating PersistentVolumes allows hostPath volumes that bypass container isolation",
    level: "high",
    match: (r) => r.resources.includes("persistentvolumes") && r.verbs.includes("create"),
  },
  {
    rule: "sa-token-create",
    description:
      "Creating service account tokens allows generating tokens for privileged service accounts",
    level: "high",
    match: (r) => r.resources.includes("serviceaccounts/token") && r.verbs.includes("create"),
  },
  {
    rule: "webhook-modify",
    description: "Modifying admission webhooks can disable security controls",
    level: "high",
    match: (r) =>
      (r.resources.includes("mutatingwebhookconfigurations") ||
        r.resources.includes("validatingwebhookconfigurations")) &&
      (r.verbs.includes("create") ||
        r.verbs.includes("update") ||
        r.verbs.includes("patch") ||
        r.verbs.includes("delete")),
  },
  {
    rule: "pods-create",
    description:
      "Creating pods grants implicit access to all secrets, configmaps, and service accounts in the namespace",
    level: "medium",
    match: (r) =>
      r.resources.includes("pods") && r.verbs.includes("create") && r.apiGroups.includes(""),
  },
  {
    rule: "namespace-update",
    description:
      "Updating namespaces can remove Pod Security labels and other security enforcement",
    level: "medium",
    match: (r) =>
      r.resources.includes("namespaces") &&
      (r.verbs.includes("update") || r.verbs.includes("patch")),
  },
];

const RISK_SCORES: Record<RbacRiskLevel, number> = {
  critical: 40,
  high: 20,
  medium: 10,
  low: 0,
};

function highestRisk(findings: RbacRiskFinding[]): RbacRiskLevel {
  if (findings.some((f) => f.level === "critical")) return "critical";
  if (findings.some((f) => f.level === "high")) return "high";
  if (findings.some((f) => f.level === "medium")) return "medium";
  return "low";
}

export function scanRoleRisks(role: RoleInput): RbacRoleRisk {
  const findings: RbacRiskFinding[] = [];

  for (const rule of role.rules) {
    for (const pattern of RISK_PATTERNS) {
      if (pattern.match(rule)) {
        findings.push({
          level: pattern.level,
          rule: pattern.rule,
          description: pattern.description,
          apiGroup: rule.apiGroups.join(", ") || "*",
          resource: rule.resources.join(", "),
          verbs: rule.verbs,
        });
      }
    }
  }

  const riskScore = findings.reduce((s, f) => s + RISK_SCORES[f.level], 0);

  return {
    name: role.name,
    namespace: role.namespace,
    kind: role.kind,
    findings,
    riskScore,
    highestRisk: highestRisk(findings),
  };
}

export function buildRbacRiskReport(roles: RoleInput[]): RbacRiskReport {
  const scanned = roles.map(scanRoleRisks);
  scanned.sort((a, b) => b.riskScore - a.riskScore);

  return {
    roles: scanned,
    summary: {
      totalRoles: scanned.length,
      criticalCount: scanned.filter((r) => r.highestRisk === "critical").length,
      highCount: scanned.filter((r) => r.highestRisk === "high").length,
      mediumCount: scanned.filter((r) => r.highestRisk === "medium").length,
      cleanCount: scanned.filter((r) => r.highestRisk === "low").length,
    },
  };
}
