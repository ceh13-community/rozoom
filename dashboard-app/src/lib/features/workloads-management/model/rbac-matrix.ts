/**
 * RBAC "Who Can" Matrix
 *
 * Aggregates all roles, clusterroles, bindings into a visual matrix:
 * subjects (users/groups/SAs) × verbs × resources.
 */

type GenericItem = Record<string, unknown>;

export type RbacSubject = {
  kind: "User" | "Group" | "ServiceAccount";
  name: string;
  namespace: string;
};

export type RbacPermission = {
  verbs: string[];
  resources: string[];
  apiGroups: string[];
  source: string;
  sourceKind: "Role" | "ClusterRole";
  isWildcard: boolean;
};

export type RbacMatrixEntry = {
  subject: RbacSubject;
  permissions: RbacPermission[];
  riskScore: number;
  riskFlags: string[];
};

export type RbacMatrixResult = {
  entries: RbacMatrixEntry[];
  totalSubjects: number;
  wildcardCount: number;
  clusterAdminCount: number;
  highRiskCount: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function extractSubjects(binding: GenericItem): RbacSubject[] {
  return asArray(asRecord(binding).subjects)
    .map((s) => {
      const sub = asRecord(s);
      return {
        kind: asString(sub.kind, "User") as RbacSubject["kind"],
        name: asString(sub.name),
        namespace: asString(sub.namespace, "cluster"),
      };
    })
    .filter((s) => s.name.length > 0);
}

function extractRoleRef(binding: GenericItem): { name: string; kind: string } {
  const ref = asRecord(asRecord(binding).roleRef);
  return {
    name: asString(ref.name),
    kind: asString(ref.kind, "Role"),
  };
}

function extractRules(role: GenericItem): RbacPermission[] {
  const roleName = asString(asRecord(role.metadata).name);
  const kind = role.kind === "ClusterRole" ? "ClusterRole" : "Role";

  return asArray(asRecord(role).rules).map((rule) => {
    const r = asRecord(rule);
    const verbs = asArray(r.verbs).map((v) => String(v));
    const resources = asArray(r.resources).map((v) => String(v));
    const apiGroups = asArray(r.apiGroups).map((v) => String(v));
    const isWildcard = verbs.includes("*") || resources.includes("*") || apiGroups.includes("*");
    return {
      verbs,
      resources,
      apiGroups,
      source: roleName,
      sourceKind: kind,
      isWildcard,
    };
  });
}

function computeSubjectRisk(
  permissions: RbacPermission[],
  roleRefNames: string[],
): {
  score: number;
  flags: string[];
} {
  let score = 0;
  const flags: string[] = [];

  if (roleRefNames.includes("cluster-admin")) {
    score += 300;
    flags.push("Bound to cluster-admin");
  }

  for (const perm of permissions) {
    if (perm.isWildcard) {
      score += 200;
      if (!flags.includes("Wildcard access")) flags.push("Wildcard access");
    }
    if (
      perm.resources.includes("secrets") &&
      perm.verbs.some((v) => ["get", "list", "watch", "*"].includes(v))
    ) {
      score += 150;
      if (!flags.includes("Secret read access")) flags.push("Secret read access");
    }
    if (perm.resources.some((r) => r === "pods/exec" || r === "pods/attach")) {
      score += 180;
      if (!flags.includes("Pod exec/attach")) flags.push("Pod exec/attach");
    }
  }

  return { score: Math.min(score, 1000), flags };
}

export function buildRbacMatrix(input: {
  roles: GenericItem[];
  clusterRoles: GenericItem[];
  roleBindings: GenericItem[];
  clusterRoleBindings: GenericItem[];
}): RbacMatrixResult {
  // Build role → rules map
  const roleRulesMap = new Map<string, RbacPermission[]>();
  for (const role of [...input.roles, ...input.clusterRoles]) {
    const name = asString(asRecord(role.metadata).name);
    roleRulesMap.set(name, extractRules(role));
  }

  // Build subject → permissions map
  const subjectMap = new Map<
    string,
    {
      subject: RbacSubject;
      permissions: RbacPermission[];
      roleRefNames: string[];
    }
  >();

  for (const binding of [...input.roleBindings, ...input.clusterRoleBindings]) {
    const roleRef = extractRoleRef(binding);
    const rules = roleRulesMap.get(roleRef.name) ?? [];
    const subjects = extractSubjects(binding);

    for (const subject of subjects) {
      const key = `${subject.kind}:${subject.namespace}/${subject.name}`;
      const existing = subjectMap.get(key);
      if (existing) {
        existing.permissions.push(...rules);
        existing.roleRefNames.push(roleRef.name);
      } else {
        subjectMap.set(key, {
          subject,
          permissions: [...rules],
          roleRefNames: [roleRef.name],
        });
      }
    }
  }

  // Build entries
  const entries: RbacMatrixEntry[] = [];
  let wildcardCount = 0;
  let clusterAdminCount = 0;

  for (const { subject, permissions, roleRefNames } of subjectMap.values()) {
    const { score, flags } = computeSubjectRisk(permissions, roleRefNames);
    entries.push({
      subject,
      permissions,
      riskScore: score,
      riskFlags: flags,
    });
    if (permissions.some((p) => p.isWildcard)) wildcardCount++;
    if (roleRefNames.includes("cluster-admin")) clusterAdminCount++;
  }

  entries.sort((a, b) => b.riskScore - a.riskScore);

  return {
    entries,
    totalSubjects: entries.length,
    wildcardCount,
    clusterAdminCount,
    highRiskCount: entries.filter((e) => e.riskScore >= 200).length,
  };
}
