/**
 * Map `kubectl get clusterroles / roles -o json` responses to the input shape
 * expected by `buildRbacRiskReport`.
 *
 * RBAC rule sources in Kubernetes:
 *   - Role: namespaced, scoped to a single namespace
 *   - ClusterRole: cluster-scoped, applies to all namespaces
 *
 * Both have the same rules[] shape. A single rule groups apiGroups/resources/
 * verbs lists, and the scanner matches risk patterns against each rule.
 */

type K8sRbacRule = {
  apiGroups?: string[];
  resources?: string[];
  verbs?: string[];
};

type K8sRoleItem = {
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
  };
  rules?: K8sRbacRule[];
};

export type RbacRoleScanInput = {
  name: string;
  namespace: string | null;
  kind: "Role" | "ClusterRole";
  rules: Array<{
    apiGroups: string[];
    resources: string[];
    verbs: string[];
  }>;
};

function normalizeRule(rule: K8sRbacRule): RbacRoleScanInput["rules"][number] {
  return {
    apiGroups: rule.apiGroups ?? [],
    resources: rule.resources ?? [],
    verbs: rule.verbs ?? [],
  };
}

function normalizeItem(
  item: K8sRoleItem,
  defaultKind: "Role" | "ClusterRole",
): RbacRoleScanInput | null {
  const name = item.metadata?.name;
  if (!name) return null;
  const kind = item.kind === "Role" || item.kind === "ClusterRole" ? item.kind : defaultKind;
  return {
    name,
    namespace: kind === "ClusterRole" ? null : (item.metadata?.namespace ?? null),
    kind,
    rules: (item.rules ?? []).map(normalizeRule),
  };
}

/**
 * Consume the JSON responses from two kubectl calls and produce the flat list
 * of roles to scan. Items without a name are skipped quietly because an
 * unnamed role cannot be referenced anywhere and is effectively noise.
 */
export function normalizeRbacRoles(
  clusterRolesResponse: { items?: K8sRoleItem[] } | null,
  rolesResponse: { items?: K8sRoleItem[] } | null,
): RbacRoleScanInput[] {
  const out: RbacRoleScanInput[] = [];
  for (const raw of clusterRolesResponse?.items ?? []) {
    const norm = normalizeItem(raw, "ClusterRole");
    if (norm) out.push(norm);
  }
  for (const raw of rolesResponse?.items ?? []) {
    const norm = normalizeItem(raw, "Role");
    if (norm) out.push(norm);
  }
  return out;
}
