/**
 * ROZOOM Plugin Registry.
 *
 * Built-in plugin catalog defining core, free, and pro features.
 * Community plugins loaded from external registry at runtime.
 */

import type { PluginManifest } from "./types";

export const BUILTIN_PLUGINS: PluginManifest[] = [
  // ── Core (always on) ──
  {
    id: "cluster-manager",
    name: "Cluster Manager",
    version: "0.17.0",
    description:
      "Add, organize, and manage Kubernetes clusters. Connect via kubeconfig, OIDC, cloud CLIs, or Vault.",
    author: "ROZOOM",
    tier: "core",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "overview",
          label: "Overview",
          section: "cluster-ops",
          description: "Cluster health overview with diagnostics",
        },
      ],
    },
  },
  {
    id: "health-checks",
    name: "Health Checks",
    version: "0.17.0",
    description:
      "37 automated health checks: API server, etcd, nodes, pods, certificates, events, probes, resources.",
    author: "ROZOOM",
    tier: "core",
    category: "observability",
    license: "Apache-2.0",
    provides: {
      healthChecks: [
        "api-server-health",
        "etcd-health",
        "node-utilization",
        "pod-issues",
        "certificate-expiry",
        "warning-events",
        "probes-health",
        "resources-hygiene",
        "hpa-status",
        "vpa-status",
        "pdb-status",
        "topology-ha",
        "priority-status",
        "pod-security",
        "network-isolation",
        "secrets-hygiene",
        "security-hardening",
        "admission-webhooks",
        "blackbox-probes",
        "image-freshness",
        "ingress-status",
        "storage-status",
        "service-mesh",
        "node-conditions",
        "kubelet-health",
        "metrics-server",
        "kube-state-metrics",
        "node-exporter",
        "api-latency",
        "apf-health",
        "pod-qos",
        "resource-quotas",
        "limit-ranges",
        "deprecation-scan",
        "version-audit",
        "backup-audit",
      ],
    },
  },
  {
    id: "workload-browser",
    name: "Workload Browser",
    version: "0.17.0",
    description:
      "Browse and manage 61 Kubernetes resource types: pods, deployments, services, ingresses, RBAC, storage, and more.",
    author: "ROZOOM",
    tier: "core",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "pods",
          label: "Pods",
          section: "cluster-ops",
          description: "Pod list with logs, exec, YAML editor",
        },
        {
          id: "deployments",
          label: "Deployments",
          section: "cluster-ops",
          description: "Deployment management",
        },
      ],
    },
  },
  {
    id: "helm-catalog",
    name: "Helm Catalog",
    version: "0.17.0",
    description:
      "25 curated Helm charts with one-click install: Prometheus, Velero, cert-manager, ArgoCD, and more.",
    author: "ROZOOM",
    tier: "core",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "helmcatalog",
          label: "Helm Catalog",
          section: "cluster-ops",
          description: "One-click chart installs",
        },
      ],
      helmCharts: [
        "kube-prometheus-stack",
        "metrics-server",
        "kube-state-metrics",
        "node-exporter",
        "velero",
        "cert-manager",
        "kubescape",
        "trivy-operator",
        "kubearmor",
        "loki",
        "promtail",
        "keda",
        "vpa",
        "descheduler",
        "goldilocks",
        "reloader",
        "sealed-secrets",
        "falco",
        "kyverno",
        "envoy-gateway",
        "external-dns",
        "opencost",
        "external-secrets",
        "opentelemetry-collector",
        "ingress-nginx",
        "argocd",
        "fluxcd",
        "prometheus-adapter",
      ],
    },
  },

  // ── Free (included, can disable) ──
  {
    id: "fleet-organization",
    name: "Fleet Organization",
    version: "0.17.0",
    description:
      "Custom groups, smart groups (rule-based), saved views, and cluster ordering for fleet management.",
    author: "ROZOOM",
    tier: "free",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      dashboardWidgets: ["custom-groups", "smart-groups", "saved-views"],
    },
  },
  {
    id: "fix-templates",
    name: "Fix Templates",
    version: "0.17.0",
    description:
      "YAML template generator for common fixes: PDB, NetworkPolicy, ResourceQuota, probes, SecurityContext.",
    author: "ROZOOM",
    tier: "free",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      analysisModules: ["fix-templates"],
    },
  },

  // ── Pro (subscription) ──
  {
    id: "security-suite",
    name: "Security Suite",
    version: "0.17.0",
    description:
      "RBAC risk scanner (13 patterns), Pod Security Standards compliance, credential hygiene checks, safety guards.",
    author: "ROZOOM",
    tier: "free",
    category: "security",
    license: "Apache-2.0",
    pricing: { type: "free" },
    provides: {
      workloadPages: [
        {
          id: "securityaudit",
          label: "Security Audit",
          section: "security",
          description: "RBAC risk + PSS compliance",
        },
        {
          id: "authsecurity",
          label: "Auth & Credentials",
          section: "security",
          description: "Auth method + credential storage",
        },
      ],
      analysisModules: [
        "rbac-risk-scanner",
        "pss-compliance",
        "credential-security",
        "credential-hygiene",
      ],
    },
  },
  {
    id: "capacity-intelligence",
    name: "Capacity Intelligence",
    version: "0.17.0",
    description:
      "Resource efficiency heatmap, node bin-packing score, autoscaling posture, cost analysis with savings opportunities.",
    author: "ROZOOM",
    tier: "free",
    category: "capacity",
    license: "Apache-2.0",
    pricing: { type: "free" },
    provides: {
      workloadPages: [
        {
          id: "capacityintelligence",
          label: "Capacity Intelligence",
          section: "cluster-ops",
          description: "Efficiency + cost",
        },
      ],
      analysisModules: [
        "resource-heatmap",
        "node-capacity",
        "bin-packing",
        "autoscaling-posture",
        "cost-efficiency",
      ],
    },
  },
  {
    id: "performance-suite",
    name: "Performance Suite",
    version: "0.17.0",
    description:
      "RED metrics dashboard, CPU throttling detector, SLO/error budget tracking with multi-window burn rate alerts.",
    author: "ROZOOM",
    tier: "free",
    category: "observability",
    license: "Apache-2.0",
    pricing: { type: "free" },
    provides: {
      workloadPages: [
        {
          id: "performanceobs",
          label: "Performance",
          section: "observability",
          description: "RED + SLO + throttling",
        },
      ],
      analysisModules: ["red-metrics", "cpu-throttling", "slo-tracking"],
    },
  },
  {
    id: "enterprise-auth",
    name: "Enterprise Auth",
    version: "0.17.0",
    description:
      "OIDC/SSO wizard (Azure AD, Okta, Keycloak), HashiCorp Vault integration, auth method detection, token expiry alerts.",
    author: "ROZOOM",
    tier: "free",
    category: "auth",
    license: "Apache-2.0",
    pricing: { type: "free" },
    provides: {
      analysisModules: ["auth-detection", "oidc-config", "vault-integration"],
    },
  },
  {
    id: "gitops-integration",
    name: "GitOps Integration",
    version: "0.17.0",
    description:
      "ArgoCD and Flux bootstrap wizard with step-by-step instructions and generated YAML manifests.",
    author: "ROZOOM",
    tier: "free",
    category: "gitops",
    license: "Apache-2.0",
    pricing: { type: "free" },
    provides: {
      workloadPages: [
        {
          id: "gitopsbootstrap",
          label: "GitOps Bootstrap",
          section: "cluster-ops",
          description: "ArgoCD / Flux setup",
        },
      ],
      analysisModules: ["gitops-bootstrap"],
    },
  },

  // ── Community example plugin ──
  {
    id: "workload-visualizer",
    name: "Workload Visualizer",
    version: "0.17.0",
    description:
      "Visual dependency map: Ingress -> Service -> Deployment -> Pod -> ConfigMap/Secret/PVC/RBAC. Click any node to see connections.",
    author: "ROZOOM Community",
    tier: "free",
    category: "developer-tools",
    license: "Apache-2.0",
    keywords: ["topology", "graph", "map", "dependencies", "visualization"],
    provides: {
      workloadPages: [
        {
          id: "visualizer",
          label: "Workload Map",
          section: "cluster-ops",
          description: "Resource dependency graph",
        },
      ],
      analysisModules: ["workload-visualizer"],
    },
  },
];

export function getPluginById(id: string): PluginManifest | undefined {
  return BUILTIN_PLUGINS.find((p) => p.id === id);
}

export function getPluginsByTier(tier: PluginManifest["tier"]): PluginManifest[] {
  return BUILTIN_PLUGINS.filter((p) => p.tier === tier);
}

export function getPluginsByCategory(category: PluginManifest["category"]): PluginManifest[] {
  return BUILTIN_PLUGINS.filter((p) => p.category === category);
}

export function getCorePlugins(): PluginManifest[] {
  return getPluginsByTier("core");
}

export function getProPlugins(): PluginManifest[] {
  return getPluginsByTier("pro");
}
