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
    defaultDisabled: true,
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
    defaultDisabled: true,
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
    defaultDisabled: true,
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
    defaultDisabled: true,
  },

  {
    id: "workload-visualizer",
    name: "Workload Visualizer",
    version: "0.17.0",
    description:
      "Visual dependency map and per-service chain view: Ingress -> Service -> Workload -> Pod -> ConfigMap/Secret/PVC/RBAC.",
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
        {
          id: "resourcemap",
          label: "Service Chains",
          section: "cluster-ops",
          description: "Per-service linear chains grouped by namespace",
        },
      ],
      analysisModules: ["workload-visualizer"],
    },
    defaultDisabled: true,
  },

  // ── New togglable plugins: audit + compliance + observability add-ons ──
  {
    id: "backup-audit",
    name: "Backup Audit",
    version: "0.17.0",
    description:
      "Velero backup recency and coverage plus local YAML backup integration. Surfaces stale backups and helps restore.",
    author: "ROZOOM",
    tier: "free",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "backupaudit",
          label: "Backup Status",
          section: "cluster-ops",
          description: "Backup recency + restore",
        },
      ],
      analysisModules: ["backup-audit", "yaml-backup"],
    },
  },
  {
    id: "cert-rotation",
    name: "Certificate Rotation",
    version: "0.17.0",
    description:
      "Control-plane and kubelet TLS certificate inventory with guided rotation wizards for kubeadm, k3s, RKE2, OpenShift.",
    author: "ROZOOM",
    tier: "free",
    category: "security",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "rotatecerts",
          label: "Rotate Certificates",
          section: "cluster-ops",
          description: "TLS cert inventory + rotation",
        },
      ],
      analysisModules: ["cert-rotation", "cert-manager-integration"],
    },
    defaultDisabled: true,
  },
  {
    id: "deprecation-audit",
    name: "Version & Deprecation Audit",
    version: "0.17.0",
    description:
      "Detect deprecated or removed Kubernetes API versions, compare cluster + Helm chart versions against policy.",
    author: "ROZOOM",
    tier: "free",
    category: "developer-tools",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "deprecationscan",
          label: "API Deprecation Scan",
          section: "cluster-ops",
          description: "Deprecated API detection via pluto",
        },
        {
          id: "versionaudit",
          label: "Version Audit",
          section: "cluster-ops",
          description: "Cluster + chart version policy",
        },
      ],
      analysisModules: ["pluto-scan", "version-audit"],
    },
  },
  {
    id: "compliance-integrations",
    name: "Compliance Integrations",
    version: "0.17.0",
    description:
      "Hubs for third-party security tools: Kubescape + kube-bench (compliance), Trivy Operator (vulns), KubeArmor (runtime).",
    author: "ROZOOM",
    tier: "free",
    category: "compliance",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "compliancehub",
          label: "Compliance Hub",
          section: "security",
          description: "Kubescape + kube-bench reports",
        },
        {
          id: "trivyhub",
          label: "Trivy",
          section: "security",
          description: "Trivy Operator vulnerability snapshot",
        },
        {
          id: "armorhub",
          label: "KubeArmor",
          section: "security",
          description: "KubeArmor runtime protection",
        },
      ],
      analysisModules: ["kubescape-integration", "trivy-integration", "kubearmor-integration"],
    },
  },
  {
    id: "alerts-hub",
    name: "Cluster Alerts Hub",
    version: "0.17.0",
    description:
      "Unified alerts feed from Alertmanager, Prometheus rules, and Warning Events. Falls back to Events when Prometheus is absent.",
    author: "ROZOOM",
    tier: "free",
    category: "observability",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "alertshub",
          label: "Cluster Alerts",
          section: "observability",
          description: "Alertmanager + Events unified feed",
        },
      ],
      analysisModules: ["alertmanager-client", "events-feed"],
    },
  },
  {
    id: "cron-monitoring",
    name: "CronJobs Monitoring",
    version: "0.17.0",
    description:
      "Detect missed schedules, repeated failures, and long-running Jobs spawned by CronJobs.",
    author: "ROZOOM",
    tier: "free",
    category: "observability",
    license: "Apache-2.0",
    provides: {
      workloadPages: [
        {
          id: "cronjobshealth",
          label: "CronJobs Monitoring",
          section: "observability",
          description: "Missed schedules + failure tracking",
        },
      ],
      analysisModules: ["cronjob-monitor"],
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
