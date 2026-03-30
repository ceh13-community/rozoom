/**
 * NetworkPolicy Analyzer
 *
 * Analyzes network isolation coverage:
 * - Which namespaces have default-deny policies?
 * - Which namespaces are completely open?
 * - Policy coverage percentage.
 */

type GenericItem = Record<string, unknown>;

export type NamespaceIsolation = {
  namespace: string;
  hasIngressDeny: boolean;
  hasEgressDeny: boolean;
  policyCount: number;
  policyNames: string[];
  isolationLevel: "full" | "ingress-only" | "egress-only" | "none";
};

export type NetworkPolicyAnalysisResult = {
  namespaces: NamespaceIsolation[];
  totalNamespaces: number;
  fullyIsolated: number;
  partiallyIsolated: number;
  open: number;
  coveragePercent: number;
  isolationScore: number;
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

function isDefaultDeny(policy: GenericItem): { ingress: boolean; egress: boolean } {
  const spec = asRecord(policy.spec);
  const policyTypes = asArray(spec.policyTypes).map((t) => String(t).toLowerCase());
  const podSelector = asRecord(spec.podSelector);
  const matchLabels = asRecord(podSelector.matchLabels);
  const matchExpressions = asArray(podSelector.matchExpressions);

  // Default deny = empty podSelector (selects all pods) + no ingress/egress rules
  const selectsAll = Object.keys(matchLabels).length === 0 && matchExpressions.length === 0;
  if (!selectsAll) return { ingress: false, egress: false };

  const hasIngressRules = asArray(spec.ingress).length > 0;
  const hasEgressRules = asArray(spec.egress).length > 0;

  return {
    ingress: policyTypes.includes("ingress") && !hasIngressRules,
    egress: policyTypes.includes("egress") && !hasEgressRules,
  };
}

export function analyzeNetworkPolicies(input: {
  namespaces: GenericItem[];
  networkPolicies: GenericItem[];
}): NetworkPolicyAnalysisResult {
  const nsMap = new Map<string, NamespaceIsolation>();

  // Initialize all namespaces
  for (const ns of input.namespaces) {
    const name = asString(asRecord(ns.metadata).name);
    if (!name) continue;
    nsMap.set(name, {
      namespace: name,
      hasIngressDeny: false,
      hasEgressDeny: false,
      policyCount: 0,
      policyNames: [],
      isolationLevel: "none",
    });
  }

  // Analyze policies
  for (const policy of input.networkPolicies) {
    const metadata = asRecord(policy.metadata);
    const ns = asString(metadata.namespace);
    const name = asString(metadata.name);

    const entry = nsMap.get(ns);
    if (!entry) continue;

    entry.policyCount++;
    entry.policyNames.push(name);

    const deny = isDefaultDeny(policy);
    if (deny.ingress) entry.hasIngressDeny = true;
    if (deny.egress) entry.hasEgressDeny = true;
  }

  // Compute isolation levels
  const namespaces: NamespaceIsolation[] = [];
  for (const entry of nsMap.values()) {
    if (entry.hasIngressDeny && entry.hasEgressDeny) {
      entry.isolationLevel = "full";
    } else if (entry.hasIngressDeny) {
      entry.isolationLevel = "ingress-only";
    } else if (entry.hasEgressDeny) {
      entry.isolationLevel = "egress-only";
    }
    namespaces.push(entry);
  }

  // Sort: open first (most concerning)
  namespaces.sort((a, b) => {
    const order = { none: 0, "egress-only": 1, "ingress-only": 2, full: 3 };
    return order[a.isolationLevel] - order[b.isolationLevel];
  });

  const total = namespaces.length || 1;
  const fullyIsolated = namespaces.filter((n) => n.isolationLevel === "full").length;
  const partiallyIsolated = namespaces.filter(
    (n) => n.isolationLevel === "ingress-only" || n.isolationLevel === "egress-only",
  ).length;
  const open = namespaces.filter((n) => n.isolationLevel === "none").length;

  // Skip system namespaces for coverage calculation
  const nonSystem = namespaces.filter(
    (n) => !n.namespace.startsWith("kube-") && n.namespace !== "default",
  );
  const nonSystemTotal = nonSystem.length || 1;
  const nonSystemIsolated = nonSystem.filter((n) => n.isolationLevel !== "none").length;

  return {
    namespaces,
    totalNamespaces: namespaces.length,
    fullyIsolated,
    partiallyIsolated,
    open,
    coveragePercent: Math.round((nonSystemIsolated / nonSystemTotal) * 100),
    isolationScore: Math.round((fullyIsolated * 100 + partiallyIsolated * 50) / total),
  };
}
