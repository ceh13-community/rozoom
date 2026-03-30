import { error as logError } from "@tauri-apps/plugin-log";
import type { ClusterData, NetworkPolicyItem, PodItem } from "$shared/model/clusters";
import { loadClusterEntities } from "./get-cluster-info";
import type {
  NetworkIsolationItem,
  NetworkIsolationReport,
  NetworkIsolationStatus,
  NetworkIsolationSummary,
} from "../model/types";

const CACHE_MS = 60 * 1000;
const cachedReports = new Map<string, { data: NetworkIsolationReport; fetchedAt: number }>();

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);
const CRITICAL_LABEL_KEYS = [
  "kubemaster.io/critical",
  "kubemaster.io/production",
  "app.kubernetes.io/critical",
  "app.kubernetes.io/production",
];

const DEFAULT_DENY_TEMPLATE = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: my-namespace
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress`;

const ALLOW_DNS_TEMPLATE = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
spec:
  podSelector: {}
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53`;

const ALLOW_INGRESS_TEMPLATE = `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress
spec:
  podSelector: {}
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx`;

function normalizeNamespace(namespace?: string): string {
  return namespace && namespace.length > 0 ? namespace : "default";
}

function resolveErrorStatus(message?: string): NetworkIsolationStatus {
  if (!message) return "unknown";
  const normalized = message.toLowerCase();
  if (
    normalized.includes("networkpolicies") &&
    (normalized.includes("not found") ||
      normalized.includes("no matches for kind") ||
      normalized.includes("unknown resource") ||
      normalized.includes("doesn't have a resource type"))
  ) {
    return "unsupported";
  }
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

function hasCriticalLabel(labels: Record<string, string> | undefined): boolean {
  if (!labels) return false;
  return CRITICAL_LABEL_KEYS.some((key) => {
    const value = labels[key];
    return value ? value.toLowerCase() === "true" : false;
  });
}

function isEmptySelector(selector?: {
  matchLabels?: Record<string, string>;
  matchExpressions?: unknown[];
}) {
  if (!selector) return false;
  const labelsEmpty = !selector.matchLabels || Object.keys(selector.matchLabels).length === 0;
  const expressionsEmpty = !selector.matchExpressions || selector.matchExpressions.length === 0;
  return labelsEmpty && expressionsEmpty;
}

function hasIngressRules(policy: NetworkPolicyItem): boolean {
  return (policy.spec.ingress?.length ?? 0) > 0;
}

function hasEgressRules(policy: NetworkPolicyItem): boolean {
  return (policy.spec.egress?.length ?? 0) > 0;
}

function resolvesPolicyTypes(policy: NetworkPolicyItem): string[] {
  return policy.spec.policyTypes ?? [];
}

function appliesIngress(policy: NetworkPolicyItem): boolean {
  const types = resolvesPolicyTypes(policy);
  if (types.length > 0) return types.includes("Ingress");
  return policy.spec.ingress !== undefined;
}

function appliesEgress(policy: NetworkPolicyItem): boolean {
  const types = resolvesPolicyTypes(policy);
  if (types.length > 0) return types.includes("Egress");
  return policy.spec.egress !== undefined;
}

function isDefaultDenyIngress(policy: NetworkPolicyItem): boolean {
  return (
    isEmptySelector(policy.spec.podSelector) && appliesIngress(policy) && !hasIngressRules(policy)
  );
}

function isDefaultDenyEgress(policy: NetworkPolicyItem): boolean {
  return (
    isEmptySelector(policy.spec.podSelector) && appliesEgress(policy) && !hasEgressRules(policy)
  );
}

function isDnsPort(port?: number | string): boolean {
  if (port === undefined) return false;
  if (typeof port === "number") return port === 53;
  return port === "53";
}

function isKubeSystemSelector(labels?: Record<string, string>): boolean {
  if (!labels) return false;
  return (
    labels["kubernetes.io/metadata.name"] === "kube-system" || labels["name"] === "kube-system"
  );
}

function allowsDns(policy: NetworkPolicyItem): boolean {
  const rules = policy.spec.egress ?? [];
  return rules.some((rule) => {
    const hasDnsPort = (rule.ports ?? []).some((port) => {
      if (!isDnsPort(port.port)) return false;
      if (!port.protocol) return true;
      return port.protocol === "UDP" || port.protocol === "TCP";
    });
    if (!hasDnsPort) return false;
    return (rule.to ?? []).some((peer) => {
      if (isKubeSystemSelector(peer.namespaceSelector?.matchLabels)) return true;
      return peer.podSelector?.matchLabels
        ? Object.values(peer.podSelector.matchLabels).some(
            (value) =>
              value.toLowerCase().includes("kube-dns") || value.toLowerCase().includes("coredns"),
          )
        : false;
    });
  });
}

function buildSummary(
  items: NetworkIsolationItem[],
  errorStatus?: NetworkIsolationStatus,
): NetworkIsolationSummary {
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

  let status: NetworkIsolationStatus = "ok";
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
  } else if (status === "unsupported") {
    message = "Not supported";
  } else if (status === "unknown") {
    message = "Unknown";
  }

  return { status, message, ...totals, updatedAt: Date.now() };
}

function evaluateNamespace(
  namespace: string,
  policies: NetworkPolicyItem[],
  pods: PodItem[],
  namespaceLabels?: Record<string, string>,
): NetworkIsolationItem {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const policyCount = policies.length;
  const isSystem = SYSTEM_NAMESPACES.has(namespace);
  const hasCriticalNamespaceLabel = hasCriticalLabel(namespaceLabels);
  const hasCriticalPod = pods.some((pod) => hasCriticalLabel(pod.metadata.labels));
  const isCriticalNamespace = hasCriticalNamespaceLabel || hasCriticalPod;

  const defaultDenyIngress = policies.some(isDefaultDenyIngress);
  const defaultDenyEgress = policies.some(isDefaultDenyEgress);
  const allowIngress = policies.some(hasIngressRules);
  const allowEgress = policies.some(hasEgressRules);
  const allowDns = policies.some(allowsDns);

  if (policyCount === 0) {
    issues.push("No NetworkPolicy in namespace.");
    recommendations.push(DEFAULT_DENY_TEMPLATE, ALLOW_DNS_TEMPLATE, ALLOW_INGRESS_TEMPLATE);
  } else {
    if (!defaultDenyIngress || !defaultDenyEgress) {
      issues.push("Default deny policy is missing.");
      recommendations.push(DEFAULT_DENY_TEMPLATE);
    }
    if (!allowIngress && defaultDenyIngress) {
      issues.push("Ingress allow rules are missing.");
      recommendations.push(ALLOW_INGRESS_TEMPLATE);
    }
    if (!allowEgress && defaultDenyEgress) {
      issues.push("Egress allow rules are missing.");
      recommendations.push(ALLOW_DNS_TEMPLATE);
    }
    if (allowEgress && !allowDns) {
      issues.push("DNS egress is not explicitly allowed.");
      recommendations.push(ALLOW_DNS_TEMPLATE);
    }
  }

  let status: NetworkIsolationStatus = "ok";
  if (issues.length > 0) {
    status = policyCount === 0 && isCriticalNamespace && !isSystem ? "critical" : "warning";
  }

  return {
    namespace,
    policyCount,
    defaultDenyIngress,
    defaultDenyEgress,
    allowIngress,
    allowEgress,
    allowDns,
    status,
    issues,
    recommendations,
  };
}

export async function checkNetworkIsolation(
  clusterId: string,
  options?: { force?: boolean; data?: ClusterData },
): Promise<NetworkIsolationReport> {
  const cached = cachedReports.get(clusterId);
  if (!options?.force && cached && Date.now() - cached.fetchedAt < CACHE_MS) {
    return cached.data;
  }

  let errorMessage: string | undefined;
  let data: ClusterData | null = null;

  try {
    data =
      options?.data ??
      (await loadClusterEntities({ uuid: clusterId }, ["namespaces", "networkpolicies", "pods"]));

    if (data.status !== "ok") {
      errorMessage = data.errors ?? "Failed to load network policy data.";
      await logError(`Network isolation check failed: ${errorMessage}`);
      data = null;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load network policy data.";
    await logError(`Network isolation check failed: ${errorMessage}`);
    data = null;
  }

  const items: NetworkIsolationItem[] = [];

  if (data) {
    const policyMap = new Map<string, NetworkPolicyItem[]>();
    data.networkpolicies.items.forEach((policy) => {
      const namespace = normalizeNamespace(policy.metadata.namespace);
      const list = policyMap.get(namespace) ?? [];
      list.push(policy);
      policyMap.set(namespace, list);
    });

    const podsByNamespace = new Map<string, PodItem[]>();
    data.pods.items.forEach((pod) => {
      const namespace = normalizeNamespace(pod.metadata.namespace);
      const list = podsByNamespace.get(namespace) ?? [];
      list.push(pod);
      podsByNamespace.set(namespace, list);
    });

    data.namespaces.items.forEach((namespace) => {
      const name = normalizeNamespace(namespace.metadata.name);
      const policies = policyMap.get(name) ?? [];
      const pods = podsByNamespace.get(name) ?? [];
      items.push(evaluateNamespace(name, policies, pods, namespace.metadata.labels));
    });
  }

  const errorStatus = errorMessage ? resolveErrorStatus(errorMessage) : undefined;
  const summary = buildSummary(items, errorStatus);

  const report: NetworkIsolationReport = {
    status: summary.status,
    summary,
    items,
    errors: errorMessage,
    updatedAt: Date.now(),
  };

  cachedReports.set(clusterId, { data: report, fetchedAt: Date.now() });
  return report;
}
