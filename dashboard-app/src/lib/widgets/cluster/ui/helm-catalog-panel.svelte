<script lang="ts">
  import {
    listHelmReleases,
    installOrUpgradeHelmRelease,
    uninstallHelmRelease,
    installPrometheusStack,
    installKubescape,
    installTrivyOperator,
    installVelero,
    installNodeExporter,
    installKubeStateMetrics,
    installMetricsServer,
    installKubeArmor,
    searchHelmChartVersions,
    showHelmChartValues,
    type HelmListedRelease,
    type HelmChartVersion,
  } from "$shared/api/helm";
  import { startPortForward, stopPortForward, activePortForwards } from "$shared/api/port-forward";
  import { openInAppUrl, openExternalUrl } from "$shared/api/in-app-browser";
  import { toast } from "svelte-sonner";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";
  import { Refresh } from "$shared/ui/icons";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import YamlEditor from "$shared/ui/yaml-editor.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { markSectionRefreshed } from "$shared/lib/section-enter-refresh";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onDestroy, onMount } from "svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type CatalogCategory =
    | "Observability"
    | "Security & Compliance"
    | "Infrastructure & Storage"
    | "Configuration & Autoscaling"
    | "Networking";

  interface CatalogChart {
    id: string;
    name: string;
    releaseName: string;
    namespace: string;
    repoName: string;
    repoUrl: string;
    chart: string;
    category: CatalogCategory;
    description: string;
    scoring: string;
    /** Optional; falls back to repoName prettified when missing */
    maintainer?: string;
    /** Optional link to the chart's docs/homepage (Grafana, Prom, ArgoCD UIs etc.) */
    docsUrl?: string;
    installFn?: (
      clusterId: string,
      onOutput?: (chunk: string) => void,
    ) => Promise<{ success: boolean; error?: string }>;
    /**
     * Default YAML values passed via helm `--values <tmpfile>` when the chart
     * is installed through the generic path (no installFn). Used for charts
     * that refuse to boot with chart defaults alone - cert-manager needs
     * installCRDs=true, loki 6+ needs a minimal SingleBinary storage config,
     * etc. Kept empty string when no override needed.
     */
    defaultValuesYaml?: string;
  }

  type PresetId = "monitoring" | "security" | "observability-lite";

  interface CatalogPreset {
    id: PresetId;
    title: string;
    description: string;
    chartIds: string[];
  }

  const PRESETS: CatalogPreset[] = [
    {
      id: "monitoring",
      title: "Full monitoring stack",
      description:
        "kube-prometheus-stack + node-exporter + kube-state-metrics + metrics-server. Gives you Prometheus + Grafana + alerting out of the box.",
      chartIds: [
        "kube-prometheus-stack",
        "prometheus-node-exporter",
        "kube-state-metrics",
        "metrics-server",
      ],
    },
    {
      id: "security",
      title: "Security baseline",
      description:
        "Kubescape (compliance) + Trivy (vulnerability scans) + cert-manager. Bumps the Security Audit score.",
      chartIds: ["kubescape-operator", "trivy-operator", "cert-manager"],
    },
    {
      id: "observability-lite",
      title: "Lightweight metrics",
      description:
        "metrics-server + kube-state-metrics only. Minimal footprint, enables kubectl top and HPA.",
      chartIds: ["metrics-server", "kube-state-metrics"],
    },
  ];

  const CATALOG: CatalogChart[] = [
    {
      id: "kube-prometheus-stack",
      name: "kube-prometheus-stack",
      releaseName: "kube-prometheus-stack",
      namespace: "monitoring",
      repoName: "prometheus-community",
      repoUrl: "https://prometheus-community.github.io/helm-charts",
      chart: "prometheus-community/kube-prometheus-stack",
      category: "Observability",
      description:
        "Full monitoring stack: Prometheus, Grafana, Alertmanager, and recording rules for K8s.",
      scoring: "Alerts, metrics collection, node/pod health. Core for 95+ score.",
      installFn: (cid, onOutput) => installPrometheusStack(cid, undefined, onOutput),
    },
    {
      id: "kube-state-metrics",
      name: "kube-state-metrics",
      releaseName: "kube-state-metrics",
      namespace: "kube-state-metrics",
      repoName: "prometheus-community",
      repoUrl: "https://prometheus-community.github.io/helm-charts",
      chart: "prometheus-community/kube-state-metrics",
      category: "Observability",
      description: "Generates metrics about K8s objects state (deployments, pods, nodes).",
      scoring: "Workload health metrics, resource utilization tracking.",
      installFn: (cid, onOutput) => installKubeStateMetrics(cid, undefined, onOutput),
    },
    {
      id: "metrics-server",
      name: "metrics-server",
      releaseName: "metrics-server",
      namespace: "kube-system",
      repoName: "metrics-server",
      repoUrl: "https://kubernetes-sigs.github.io/metrics-server/",
      chart: "metrics-server/metrics-server",
      category: "Observability",
      description: "Cluster-wide resource metrics (CPU/memory) for HPA and kubectl top.",
      scoring: "Resource utilization data, HPA functionality.",
      installFn: (cid, onOutput) => installMetricsServer(cid, undefined, undefined, onOutput),
    },
    {
      id: "prometheus-node-exporter",
      name: "prometheus-node-exporter",
      releaseName: "prometheus-node-exporter",
      namespace: "monitoring",
      repoName: "prometheus-community",
      repoUrl: "https://prometheus-community.github.io/helm-charts",
      chart: "prometheus-community/prometheus-node-exporter",
      category: "Observability",
      description: "Hardware and OS metrics from each node (disk, CPU, memory, network).",
      scoring: "Node pressure detection, disk/memory saturation alerts.",
      installFn: (cid, onOutput) => installNodeExporter(cid, undefined, onOutput),
    },
    {
      id: "kubescape-operator",
      name: "kubescape-operator",
      releaseName: "kubescape-operator",
      namespace: "kubescape",
      repoName: "kubescape",
      repoUrl: "https://kubescape.github.io/helm-charts/",
      chart: "kubescape/kubescape-operator",
      category: "Security & Compliance",
      description: "NSA/CISA compliance scanning, misconfigurations, RBAC analysis.",
      scoring: "Compliance Hub checks, security posture, RBAC audit. Core for 95+ score.",
      installFn: (cid, onOutput) => installKubescape(cid, undefined, onOutput),
    },
    {
      id: "trivy-operator",
      name: "trivy-operator",
      releaseName: "trivy-operator",
      namespace: "trivy-system",
      repoName: "aquasecurity",
      repoUrl: "https://aquasecurity.github.io/helm-charts/",
      chart: "aquasecurity/trivy-operator",
      category: "Security & Compliance",
      description: "Vulnerability scanning for container images, configs, and secrets.",
      scoring: "Trivy Hub vulnerability reports. Core for 95+ score.",
      installFn: (cid, onOutput) => installTrivyOperator(cid, undefined, onOutput),
    },
    {
      id: "kubearmor-operator",
      name: "kubearmor-operator",
      releaseName: "kubearmor-operator",
      namespace: "kubearmor",
      repoName: "kubearmor",
      repoUrl: "https://kubearmor.github.io/charts",
      chart: "kubearmor/kubearmor-operator",
      category: "Security & Compliance",
      description: "Runtime security enforcement with system-level policies for pods.",
      scoring: "Armor Hub runtime protection, container hardening.",
      installFn: (cid, onOutput) => installKubeArmor(cid, undefined, onOutput),
    },
    {
      id: "cert-manager",
      name: "cert-manager",
      releaseName: "cert-manager",
      namespace: "cert-manager",
      repoName: "jetstack",
      repoUrl: "https://charts.jetstack.io",
      chart: "jetstack/cert-manager",
      category: "Security & Compliance",
      description: "Automated TLS certificate management with Let's Encrypt and other issuers.",
      scoring: "TLS coverage, certificate expiry checks. Core for 95+ score.",
      // Without installCRDs=true the chart installs but no Certificate /
      // ClusterIssuer CRDs are created - controller is non-functional.
      // Jetstack docs require either this flag or a separate CRD apply.
      defaultValuesYaml: "installCRDs: true\n",
    },
    {
      id: "falco",
      name: "falco",
      releaseName: "falco",
      namespace: "falco",
      repoName: "falcosecurity",
      repoUrl: "https://falcosecurity.github.io/charts/",
      chart: "falcosecurity/falco",
      category: "Security & Compliance",
      description:
        "Runtime threat detection - detects anomalous activity in containers and hosts via syscall monitoring.",
      scoring: "Runtime security alerts, intrusion detection, anomaly scoring.",
    },
    {
      id: "kyverno",
      name: "kyverno",
      releaseName: "kyverno",
      namespace: "kyverno",
      repoName: "kyverno",
      repoUrl: "https://kyverno.github.io/kyverno/",
      chart: "kyverno/kyverno",
      category: "Security & Compliance",
      description:
        "Policy engine for K8s - validate, mutate, and generate resources. Enforce best practices on deploy.",
      scoring: "Policy enforcement, admission control, security guardrails.",
    },
    {
      id: "sealed-secrets",
      name: "sealed-secrets",
      releaseName: "sealed-secrets",
      namespace: "kube-system",
      repoName: "sealed-secrets",
      repoUrl: "https://bitnami-labs.github.io/sealed-secrets",
      chart: "sealed-secrets/sealed-secrets",
      category: "Security & Compliance",
      description:
        "Encrypt Secrets for safe storage in Git. One-way encryption with cluster-side decryption only.",
      scoring: "Secrets management, GitOps security, secret rotation.",
    },
    {
      id: "velero",
      name: "velero",
      releaseName: "velero",
      namespace: "velero",
      repoName: "vmware-tanzu",
      repoUrl: "https://vmware-tanzu.github.io/helm-charts",
      chart: "vmware-tanzu/velero",
      category: "Infrastructure & Storage",
      description: "Backup and disaster recovery for cluster resources and persistent volumes.",
      scoring: "Backup Audit checks, disaster recovery readiness. Core for 95+ score.",
      installFn: (cid, onOutput) => installVelero(cid, undefined, undefined, onOutput),
    },
    {
      id: "reloader",
      name: "reloader",
      releaseName: "reloader",
      namespace: "reloader",
      repoName: "stakater",
      repoUrl: "https://stakater.github.io/stakater-charts",
      chart: "stakater/reloader",
      category: "Infrastructure & Storage",
      description:
        "Auto-restarts Deployments/StatefulSets/DaemonSets when ConfigMaps or Secrets change.",
      scoring: "Config drift prevention, rolling update automation.",
    },
    {
      id: "loki",
      name: "loki",
      releaseName: "loki",
      namespace: "monitoring",
      repoName: "grafana",
      repoUrl: "https://grafana.github.io/helm-charts",
      chart: "grafana/loki",
      category: "Observability",
      description:
        "Log aggregation system by Grafana. Lightweight alternative to ELK, pairs with Prometheus.",
      scoring: "Log collection, error correlation, audit trail.",
      // Loki chart v6+ rejects the default config: SingleBinary mode needs an
      // explicit storage + schema block, and the scalable replicas must be
      // zeroed out. This is the minimum working config for kick-the-tyres
      // installs; production deployments should customise via the Helm page.
      defaultValuesYaml: `deploymentMode: SingleBinary
loki:
  auth_enabled: false
  commonConfig:
    replication_factor: 1
  storage:
    type: filesystem
  schemaConfig:
    configs:
      - from: "2024-01-01"
        store: tsdb
        object_store: filesystem
        schema: v13
        index:
          prefix: loki_index_
          period: 24h
singleBinary:
  replicas: 1
read:
  replicas: 0
write:
  replicas: 0
backend:
  replicas: 0
chunksCache:
  enabled: false
resultsCache:
  enabled: false
test:
  enabled: false
lokiCanary:
  enabled: false
`,
    },
    {
      id: "promtail",
      name: "promtail",
      releaseName: "promtail",
      namespace: "monitoring",
      repoName: "grafana",
      repoUrl: "https://grafana.github.io/helm-charts",
      chart: "grafana/promtail",
      category: "Observability",
      description:
        "Log collector agent that ships pod logs to Loki. Runs as DaemonSet on every node.",
      scoring: "Log shipping, pod log visibility, debug support.",
    },
    {
      id: "envoy-gateway",
      name: "envoy-gateway",
      releaseName: "envoy-gateway",
      namespace: "envoy-gateway-system",
      // Envoy Gateway is only published to a Docker Hub OCI registry - there
      // is no public HTTPS helm repo. repoName/repoUrl are kept empty so the
      // install path skips `helm repo add` and hands the OCI ref directly to
      // `helm install`.
      repoName: "",
      repoUrl: "",
      chart: "oci://docker.io/envoyproxy/gateway-helm",
      category: "Networking",
      description:
        "Kubernetes Gateway API implementation powered by Envoy proxy. Replaces deprecated ingress-nginx.",
      scoring: "Gateway API routing, TLS termination, traffic management.",
    },
    {
      id: "external-dns",
      name: "external-dns",
      releaseName: "external-dns",
      namespace: "external-dns",
      repoName: "external-dns",
      repoUrl: "https://kubernetes-sigs.github.io/external-dns/",
      chart: "external-dns/external-dns",
      category: "Networking",
      description: "Automatically manages DNS records from K8s resources (Services, Ingresses).",
      scoring: "DNS automation, service discovery.",
    },
    {
      id: "vpa",
      name: "vertical-pod-autoscaler",
      releaseName: "vpa",
      namespace: "kube-system",
      repoName: "cowboysysop",
      repoUrl: "https://cowboysysop.github.io/charts/",
      chart: "cowboysysop/vertical-pod-autoscaler",
      category: "Configuration & Autoscaling",
      description: "Automatically adjusts CPU/memory requests based on usage patterns.",
      scoring: "Resource right-sizing, cost optimization.",
    },
    {
      id: "goldilocks",
      name: "goldilocks",
      releaseName: "goldilocks",
      namespace: "goldilocks",
      repoName: "fairwinds-stable",
      repoUrl: "https://charts.fairwinds.com/stable",
      chart: "fairwinds-stable/goldilocks",
      category: "Configuration & Autoscaling",
      description: "Resource recommendation dashboard using VPA data to right-size workloads.",
      scoring: "Resource quota optimization, cost efficiency.",
    },
    {
      id: "keda",
      name: "keda",
      releaseName: "keda",
      namespace: "keda",
      repoName: "kedacore",
      repoUrl: "https://kedacore.github.io/charts",
      chart: "kedacore/keda",
      category: "Configuration & Autoscaling",
      description:
        "Event-driven autoscaling for K8s workloads - scale on HTTP traffic, queues, cron, custom metrics.",
      scoring: "Autoscaling coverage, event-driven scaling, resource efficiency.",
    },
    {
      id: "descheduler",
      name: "descheduler",
      releaseName: "descheduler",
      namespace: "kube-system",
      repoName: "descheduler",
      repoUrl: "https://kubernetes-sigs.github.io/descheduler/",
      chart: "descheduler/descheduler",
      category: "Configuration & Autoscaling",
      description:
        "Evicts pods to rebalance across nodes based on policies (affinity violations, node utilization).",
      scoring: "Pod distribution balance, node utilization optimization.",
    },
    {
      id: "opencost",
      name: "opencost",
      releaseName: "opencost",
      namespace: "opencost",
      repoName: "opencost",
      repoUrl: "https://opencost.github.io/opencost-helm-chart",
      chart: "opencost/opencost",
      category: "Observability",
      description:
        "Real-time cost monitoring for K8s. Cost allocation by namespace, label, and workload.",
      scoring: "Cost visibility, resource efficiency, budget tracking.",
    },
    {
      id: "external-secrets",
      name: "external-secrets-operator",
      releaseName: "external-secrets",
      namespace: "external-secrets",
      repoName: "external-secrets",
      // charts.external-secrets.io 302-redirects to external-secrets.io.
      // Modern helm follows it, but pinning the canonical endpoint avoids
      // corp proxies that drop redirects.
      repoUrl: "https://external-secrets.io",
      chart: "external-secrets/external-secrets",
      category: "Security & Compliance",
      description:
        "Sync secrets from Vault, AWS SM, GCP SM, Azure KV to K8s Secrets automatically.",
      scoring: "Secrets management, external secret sync, rotation compliance.",
    },
    {
      id: "opentelemetry-collector",
      name: "opentelemetry-collector",
      releaseName: "otel-collector",
      namespace: "opentelemetry",
      repoName: "open-telemetry",
      repoUrl: "https://open-telemetry.github.io/opentelemetry-helm-charts",
      chart: "open-telemetry/opentelemetry-collector",
      category: "Observability",
      description:
        "Vendor-neutral telemetry pipeline - collect, process, and export traces, metrics, and logs.",
      scoring: "Distributed tracing, metrics pipeline, log forwarding.",
    },
    {
      id: "nginx-ingress",
      name: "nginx-ingress",
      releaseName: "nginx-ingress",
      namespace: "nginx-ingress",
      repoName: "nginx-stable",
      // F5/NGINX official Helm repo (NGINX Ingress Controller by NGINX Inc).
      // Note this is a different project from the CNCF community
      // kubernetes/ingress-nginx - F5 ships their own supported controller
      // with commercial options and the official chart lives here.
      repoUrl: "https://helm.nginx.com/stable",
      chart: "nginx-stable/nginx-ingress",
      category: "Networking",
      description:
        "Official F5 NGINX Ingress Controller. Production-grade, commercially supported, same codebase as NGINX Plus.",
      scoring: "Traffic routing, TLS termination, rate limiting, commercial support path.",
    },
    {
      id: "traefik",
      name: "traefik",
      releaseName: "traefik",
      namespace: "traefik",
      repoName: "traefik",
      repoUrl: "https://traefik.github.io/charts",
      chart: "traefik/traefik",
      category: "Networking",
      description:
        "Cloud-native reverse proxy and Ingress / Gateway API controller. Dynamic configuration, Let's Encrypt integration, dashboard UI.",
      scoring: "Traffic routing, TLS termination, Gateway API support, dashboard visibility.",
    },
    {
      id: "argocd",
      name: "argo-cd",
      releaseName: "argocd",
      namespace: "argocd",
      repoName: "argo",
      repoUrl: "https://argoproj.github.io/argo-helm",
      chart: "argo/argo-cd",
      category: "Infrastructure & Storage",
      description:
        "Declarative GitOps continuous delivery for K8s. Sync cluster state from Git repositories.",
      scoring: "GitOps adoption, deployment automation, drift detection.",
    },
    {
      id: "fluxcd",
      name: "flux2",
      releaseName: "flux",
      namespace: "flux-system",
      repoName: "fluxcd-community",
      repoUrl: "https://fluxcd-community.github.io/helm-charts",
      chart: "fluxcd-community/flux2",
      category: "Infrastructure & Storage",
      description:
        "GitOps toolkit for K8s - keeps clusters in sync with Git sources, Helm charts, and OCI artifacts.",
      scoring: "GitOps adoption, Helm release automation, image update automation.",
    },
    {
      id: "prometheus-adapter",
      name: "prometheus-adapter",
      releaseName: "prometheus-adapter",
      namespace: "monitoring",
      repoName: "prometheus-community",
      repoUrl: "https://prometheus-community.github.io/helm-charts",
      chart: "prometheus-community/prometheus-adapter",
      category: "Configuration & Autoscaling",
      description:
        "Expose Prometheus metrics as custom/external metrics for HPA. Scale on any Prometheus query.",
      scoring: "Custom metrics HPA, application-aware autoscaling.",
    },
  ];

  const CATEGORIES: CatalogCategory[] = [
    "Observability",
    "Security & Compliance",
    "Infrastructure & Storage",
    "Configuration & Autoscaling",
    "Networking",
  ];

  let releases = $state<HelmListedRelease[]>([]);
  let deploymentNames = $state<Set<string>>(new Set());
  let isLoading = $state(false);
  let hasLoaded = $state(false);
  let actionInFlight = $state<string | null>(null);
  let actionNotice = $state<{ type: "success" | "error"; text: string } | null>(null);
  // Shared console for install/uninstall runs. Only one action is in flight
  // at a time (actionInFlight gate), so a single session is safe to reuse.
  const session = createConsoleSession();
  let currentActionLabel = $state("Helm");

  let searchQuery = $state("");
  let collapsedCategories = $state<Set<CatalogCategory>>(new Set());
  let chartVersions = $state<Record<string, string>>({});
  let presetProgress = $state<{
    id: PresetId;
    total: number;
    done: number;
    current: string | null;
    failures: string[];
  } | null>(null);
  let previewDialog = $state<{
    chart: CatalogChart;
    version: string;
    output: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  let valuesDialog = $state<{
    chart: CatalogChart;
    version: string;
    yaml: string;
    defaults: string;
    loadingDefaults: boolean;
    installing: boolean;
    error: string | null;
  } | null>(null);
  let chartVersionsCache = $state<Record<string, HelmChartVersion[]>>({});
  let loadingVersionsFor = $state<Set<string>>(new Set());
  let openingUiFor = $state<string | null>(null);

  const STORAGE_KEY_COLLAPSED = "helm-catalog:collapsed-categories:v1";
  const STORAGE_KEY_VERSIONS = "helm-catalog:chart-versions:v1";

  function loadLocalStorageState() {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_COLLAPSED);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        collapsedCategories = new Set(
          parsed.filter((c): c is CatalogCategory => CATEGORIES.includes(c as CatalogCategory)),
        );
      }
    } catch {
      // ignore
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_VERSIONS);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === "object") chartVersions = parsed;
      }
    } catch {
      // ignore
    }
  }

  function persistCollapsed() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify([...collapsedCategories]));
    } catch {
      // ignore
    }
  }

  function persistVersions() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY_VERSIONS, JSON.stringify(chartVersions));
    } catch {
      // ignore
    }
  }

  function toggleCategory(category: CatalogCategory) {
    const next = new Set(collapsedCategories);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    collapsedCategories = next;
    persistCollapsed();
  }

  function maintainerFor(chart: CatalogChart): string {
    if (chart.maintainer) return chart.maintainer;
    return chart.repoName.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  const filteredCatalog = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CATALOG;
    return CATALOG.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.chart.toLowerCase().includes(q) ||
        c.repoName.toLowerCase().includes(q),
    );
  });

  const filteredCountsByCategory = $derived.by(() => {
    const counts = new Map<CatalogCategory, number>();
    for (const c of filteredCatalog) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    return counts;
  });

  function isHelmInstalled(chart: CatalogChart): boolean {
    return releases.some(
      (r) => r.name === chart.releaseName || (r.chart || "").toLowerCase().startsWith(chart.id),
    );
  }

  function isDetectedInCluster(chart: CatalogChart): boolean {
    return deploymentNames.has(chart.releaseName) || deploymentNames.has(chart.id);
  }

  function isInstalled(chart: CatalogChart): boolean {
    return isHelmInstalled(chart) || isDetectedInCluster(chart);
  }

  function getInstalledRelease(chart: CatalogChart): HelmListedRelease | undefined {
    return releases.find(
      (r) => r.name === chart.releaseName || (r.chart || "").toLowerCase().startsWith(chart.id),
    );
  }

  async function refreshReleases() {
    if (!clusterId || isLoading) return;
    isLoading = true;
    try {
      const [helmResult, deploymentsRaw] = await Promise.all([
        listHelmReleases(clusterId),
        kubectlRawFront("get deployments -A -o json", { clusterId }),
      ]);
      releases = helmResult.releases;
      if (!deploymentsRaw.errors.length) {
        try {
          const json = JSON.parse(deploymentsRaw.output) as {
            items?: Array<{ metadata: { name: string } }>;
          };
          deploymentNames = new Set((json.items ?? []).map((d) => d.metadata.name.toLowerCase()));
        } catch {
          deploymentNames = new Set();
        }
      }
    } finally {
      isLoading = false;
      hasLoaded = true;
    }
  }

  type ChartUi = {
    /**
     * Service name to port-forward. May contain `{release}` which is
     * substituted with the actual helm release name at resolve time.
     * Example: kube-prometheus-stack installs a Grafana svc named
     * `<release>-grafana`, so with release `kps` the svc is `kps-grafana`.
     */
    service: string;
    remotePort: number;
    localPort: number;
    scheme?: "http" | "https";
    /**
     * Override namespace if the UI lives in a different ns than where the
     * release is installed. Usually left unset so the release namespace is
     * used directly.
     */
    namespace?: string;
    /** Human label for the "Open" button */
    label: string;
    /** Path appended to URL (e.g. /graph) */
    path?: string;
  };

  const CHART_UI: Record<string, ChartUi> = {
    "kube-prometheus-stack": {
      service: "{release}-grafana",
      remotePort: 80,
      localPort: 13000,
      scheme: "http",
      label: "Open Grafana",
    },
    "trivy-operator": {
      service: "trivy-operator",
      remotePort: 8080,
      localPort: 18081,
      scheme: "http",
      label: "Open Trivy",
    },
    argocd: {
      // argo-cd chart installs the API server as svc/argocd-server regardless
      // of release name. Port 80 is the HTTP listener when insecure mode is
      // enabled in values (common default for dev), otherwise 443 over HTTPS.
      service: "argocd-server",
      remotePort: 80,
      localPort: 18080,
      scheme: "http",
      label: "Open ArgoCD",
    },
    opencost: {
      // opencost chart exposes the UI on the primary service on port 9090.
      service: "opencost",
      remotePort: 9090,
      localPort: 19094,
      scheme: "http",
      label: "Open OpenCost",
    },
    goldilocks: {
      service: "goldilocks-dashboard",
      remotePort: 80,
      localPort: 18085,
      scheme: "http",
      label: "Open Goldilocks",
    },
  };

  function uiConfigFor(chart: CatalogChart): ChartUi | null {
    return CHART_UI[chart.id] ?? null;
  }

  function resolveServiceName(ui: ChartUi, releaseName: string): string {
    return ui.service.replace("{release}", releaseName);
  }

  function resolveUiNamespace(
    ui: ChartUi,
    release: HelmListedRelease | undefined,
    chart: CatalogChart,
  ): string {
    return ui.namespace ?? release?.namespace ?? chart.namespace;
  }

  function uiForwardKey(
    chart: CatalogChart,
    ui: ChartUi,
    release: HelmListedRelease | undefined,
  ): string {
    const ns = resolveUiNamespace(ui, release, chart);
    const svc = resolveServiceName(ui, release?.name ?? chart.releaseName);
    return `${clusterId}:${ns}:svc/${svc}:${ui.localPort}:${ui.remotePort}`;
  }

  // Port-forwards we started from this panel - tracked so we can stop them
  // on unmount. Live forwards started outside this session (already present
  // in $activePortForwards) are not reaped; user owns those.
  let startedForwards = new Set<string>();

  async function openChartUi(chart: CatalogChart, target: "in-app" | "external") {
    const ui = uiConfigFor(chart);
    if (!ui) return;
    const release = getInstalledRelease(chart);
    const ns = resolveUiNamespace(ui, release, chart);
    const svc = resolveServiceName(ui, release?.name ?? chart.releaseName);
    const key = uiForwardKey(chart, ui, release);
    openingUiFor = chart.id;
    try {
      const existing = $activePortForwards[key];
      if (!existing || !existing.isRunning) {
        const result = await startPortForward({
          namespace: ns,
          resource: `svc/${svc}`,
          remotePort: ui.remotePort,
          localPort: ui.localPort,
          clusterId,
          uniqueKey: key,
        });
        if (!result.success) {
          toast.error(`Port-forward failed: ${result.error?.slice(0, 200) ?? "unknown"}`);
          return;
        }
        startedForwards.add(key);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      const url = `${ui.scheme ?? "http"}://localhost:${ui.localPort}${ui.path ?? ""}`;
      if (target === "external") await openExternalUrl(url);
      else await openInAppUrl(url);
    } finally {
      openingUiFor = null;
    }
  }

  async function stopChartUi(chart: CatalogChart) {
    const ui = uiConfigFor(chart);
    if (!ui) return;
    const release = getInstalledRelease(chart);
    const key = uiForwardKey(chart, ui, release);
    if ($activePortForwards[key]?.isRunning) {
      await stopPortForward(key);
      toast.success(`Stopped port-forward for ${chart.name}`);
    }
  }

  async function ensureVersionsLoaded(chart: CatalogChart) {
    if (chartVersionsCache[chart.id] !== undefined) return;
    if (loadingVersionsFor.has(chart.id)) return;
    loadingVersionsFor = new Set([...loadingVersionsFor, chart.id]);
    try {
      const result = await searchHelmChartVersions(chart.chart, 30, {
        repoName: chart.repoName,
        repoUrl: chart.repoUrl,
      });
      chartVersionsCache = {
        ...chartVersionsCache,
        [chart.id]: result.versions,
      };
    } finally {
      const next = new Set(loadingVersionsFor);
      next.delete(chart.id);
      loadingVersionsFor = next;
    }
  }

  async function openValuesEditor(chart: CatalogChart) {
    if (actionInFlight) return;
    const version = (chartVersions[chart.id] ?? "").trim();
    valuesDialog = {
      chart,
      version: version || "latest",
      yaml: "",
      defaults: "",
      loadingDefaults: true,
      installing: false,
      error: null,
    };
    const result = await showHelmChartValues(chart.chart, version || undefined, {
      repoName: chart.repoName,
      repoUrl: chart.repoUrl,
    });
    if (!valuesDialog || valuesDialog.chart.id !== chart.id) return;
    if (result.error) {
      valuesDialog = {
        ...valuesDialog,
        loadingDefaults: false,
        error: result.error,
        defaults: "",
        yaml: "# Could not load chart defaults. Start with your own values.\n",
      };
      return;
    }
    const defaults = result.values || "# Chart has no default values.\n";
    valuesDialog = {
      ...valuesDialog,
      loadingDefaults: false,
      defaults,
      yaml: defaults,
      error: null,
    };
  }

  function closeValuesEditor() {
    valuesDialog = null;
  }

  function resetValuesToDefaults() {
    if (!valuesDialog) return;
    valuesDialog = { ...valuesDialog, yaml: valuesDialog.defaults };
  }

  async function installWithCustomValues() {
    if (!valuesDialog) return;
    const chart = valuesDialog.chart;
    const yaml = valuesDialog.yaml;
    valuesDialog = { ...valuesDialog, installing: true, error: null };
    try {
      const version = (chartVersions[chart.id] ?? "").trim();
      const result = await installOrUpgradeHelmRelease(clusterId, {
        releaseName: chart.releaseName,
        chart: chart.chart,
        namespace: chart.namespace,
        createNamespace: true,
        chartVersion: version || undefined,
        valuesYaml: yaml.trim() ? yaml : undefined,
        repoName: chart.repoName,
        repoUrl: chart.repoUrl,
      });
      if (!result.success) {
        valuesDialog = {
          ...valuesDialog,
          installing: false,
          error: result.error ?? "Install failed",
        };
        return;
      }
      valuesDialog = null;
      actionNotice = { type: "success", text: `${chart.name} installed with custom values` };
      await refreshReleases();
    } catch (err) {
      if (valuesDialog) {
        valuesDialog = {
          ...valuesDialog,
          installing: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  async function runInstall(
    chart: CatalogChart,
    onOutput?: (chunk: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    const version = (chartVersions[chart.id] ?? "").trim();
    if (chart.installFn && !version) {
      // Use the curated installFn only when no custom version is requested;
      // custom versions must go through the generic helm install path.
      return chart.installFn(clusterId, onOutput);
    }
    return installOrUpgradeHelmRelease(clusterId, {
      releaseName: chart.releaseName,
      chart: chart.chart,
      namespace: chart.namespace,
      createNamespace: true,
      chartVersion: version || undefined,
      repoName: chart.repoName,
      repoUrl: chart.repoUrl,
      valuesYaml: chart.defaultValuesYaml,
      onOutput,
    });
  }

  async function handleInstall(chart: CatalogChart) {
    if (actionInFlight) return;
    const version = (chartVersions[chart.id] ?? "").trim();
    const versionLabel = version ? `version ${version}` : "latest version";
    const confirmed = await confirmAction(
      `Install ${chart.name} (${versionLabel}) into namespace "${chart.namespace}"?\n\n` +
        `This will run helm upgrade --install and may create resources on the cluster. ` +
        `Use Preview (dry-run) first if you want to see what will change.`,
      `Install ${chart.name}`,
    );
    if (!confirmed) return;
    actionInFlight = chart.id;
    actionNotice = null;
    currentActionLabel = `Installing ${chart.name}`;
    session.start();
    const onOutput = (chunk: string) => session.append(chunk);

    try {
      const result = await runInstall(chart, onOutput);
      if (result.success) {
        actionNotice = { type: "success", text: `${chart.name} installed successfully` };
        session.succeed();
      } else {
        actionNotice = {
          type: "error",
          text: result.error ?? `Failed to install ${chart.name}`,
        };
        session.fail();
      }
      await refreshReleases();
    } catch (err) {
      actionNotice = {
        type: "error",
        text: err instanceof Error ? err.message : `Failed to install ${chart.name}`,
      };
      session.fail();
    } finally {
      actionInFlight = null;
    }
  }

  async function handlePreview(chart: CatalogChart) {
    if (actionInFlight) return;
    const version = (chartVersions[chart.id] ?? "").trim();
    previewDialog = {
      chart,
      version: version || "latest",
      output: "",
      loading: true,
      error: null,
    };
    actionInFlight = `preview:${chart.id}`;
    try {
      const result = await installOrUpgradeHelmRelease(clusterId, {
        releaseName: chart.releaseName,
        chart: chart.chart,
        namespace: chart.namespace,
        createNamespace: true,
        chartVersion: version || undefined,
        dryRun: true,
        repoName: chart.repoName,
        repoUrl: chart.repoUrl,
      });
      if (!result.success) {
        previewDialog = {
          ...previewDialog,
          loading: false,
          error: result.error ?? "Dry-run failed",
        };
        return;
      }
      previewDialog = {
        ...previewDialog,
        output: (result.output ?? "").trim() || "(empty)",
        loading: false,
        error: null,
      };
    } finally {
      actionInFlight = null;
    }
  }

  function closePreview() {
    previewDialog = null;
  }

  async function confirmInstallFromPreview() {
    if (!previewDialog) return;
    const chart = previewDialog.chart;
    closePreview();
    if (actionInFlight) return;
    actionInFlight = chart.id;
    actionNotice = null;
    try {
      const result = await runInstall(chart);
      actionNotice = result.success
        ? { type: "success", text: `${chart.name} installed successfully` }
        : { type: "error", text: result.error ?? `Failed to install ${chart.name}` };
      await refreshReleases();
    } finally {
      actionInFlight = null;
    }
  }

  async function handlePreset(preset: CatalogPreset) {
    if (actionInFlight) return;
    const targets = preset.chartIds
      .map((id) => CATALOG.find((c) => c.id === id))
      .filter((c): c is CatalogChart => Boolean(c))
      .filter((c) => !isInstalled(c));
    if (targets.length === 0) {
      actionNotice = {
        type: "success",
        text: `All charts in "${preset.title}" are already installed.`,
      };
      return;
    }
    const confirmed = await confirmAction(
      `Install ${targets.length} chart(s) as part of "${preset.title}"?\n\n` +
        targets.map((c) => `  - ${c.name} (ns: ${c.namespace})`).join("\n") +
        `\n\nCharts install one by one; progress is shown above.`,
      `Install preset: ${preset.title}`,
    );
    if (!confirmed) return;

    presetProgress = {
      id: preset.id,
      total: targets.length,
      done: 0,
      current: null,
      failures: [],
    };
    actionNotice = null;
    // Hold a batch-level guard for the duration of the preset loop so per-
    // chart reset between iterations does not open a window for concurrent
    // clicks from other buttons.
    actionInFlight = `preset:${preset.id}`;
    currentActionLabel = `Installing preset: ${preset.title}`;
    session.start();
    const onOutput = (chunk: string) => session.append(chunk);
    try {
      for (const chart of targets) {
        presetProgress = { ...presetProgress, current: chart.name };
        session.append(`\n--- ${chart.name} (ns: ${chart.namespace}) ---\n`);
        try {
          const result = await runInstall(chart, onOutput);
          if (!result.success) {
            presetProgress = {
              ...presetProgress,
              failures: [
                ...presetProgress.failures,
                `${chart.name}: ${result.error ?? "unknown error"}`,
              ],
            };
          }
        } finally {
          presetProgress = { ...presetProgress, done: presetProgress.done + 1 };
        }
      }
      await refreshReleases();
      const fails = presetProgress.failures;
      if (fails.length === 0) {
        actionNotice = { type: "success", text: `Preset "${preset.title}" installed.` };
        session.succeed();
      } else {
        actionNotice = {
          type: "error",
          text: `Preset "${preset.title}" installed with ${fails.length} failure(s). First: ${fails[0]}`,
        };
        session.fail();
      }
    } finally {
      presetProgress = null;
      actionInFlight = null;
    }
  }

  async function handleUninstall(chart: CatalogChart) {
    if (actionInFlight) return;

    const installed = getInstalledRelease(chart);
    const releaseName = installed?.name ?? chart.releaseName;
    const namespace = installed?.namespace ?? chart.namespace;

    const confirmed = await confirmAction(
      `Uninstall ${releaseName} from namespace ${namespace}?`,
      "Uninstall Helm Release",
    );
    if (!confirmed) return;

    actionInFlight = chart.id;
    actionNotice = null;
    currentActionLabel = `Uninstalling ${chart.name}`;
    session.start();

    try {
      const result = await uninstallHelmRelease(clusterId, {
        releaseName,
        namespace,
        onOutput: (chunk) => session.append(chunk),
      });

      if (result.success) {
        actionNotice = { type: "success", text: `${chart.name} uninstalled successfully` };
        session.succeed();
      } else {
        actionNotice = {
          type: "error",
          text: result.error ?? `Failed to uninstall ${chart.name}`,
        };
        session.fail();
      }
      await refreshReleases();
    } catch (err) {
      actionNotice = {
        type: "error",
        text: err instanceof Error ? err.message : `Failed to uninstall ${chart.name}`,
      };
      session.fail();
    } finally {
      actionInFlight = null;
    }
  }

  function chartsByCategory(category: CatalogCategory): CatalogChart[] {
    return filteredCatalog.filter((c) => c.category === category);
  }

  onMount(() => {
    loadLocalStorageState();
  });

  onDestroy(() => {
    // Stop any port-forwards this panel started - they were only meant to
    // bridge the user into the chart UI for the current session. Forwards
    // started elsewhere (Network > Port Forwarding page, Helm page) are left
    // alone; we only reap our own.
    for (const key of startedForwards) {
      if ($activePortForwards[key]?.isRunning) {
        void stopPortForward(key);
      }
    }
    startedForwards.clear();
  });

  $effect(() => {
    if (clusterId && !offline && !hasLoaded && !isLoading) {
      refreshReleases().then(() => markSectionRefreshed(`helmcatalog:${clusterId}`));
    }
  });
</script>

<div class="flex flex-col gap-4">
  <Card.Root>
    <Card.Header class="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
      <div class="min-w-0 flex-1">
        <Card.Title class="text-base font-semibold">Helm Catalog</Card.Title>
        <Card.Description class="text-xs text-muted-foreground">
          Curated charts to improve cluster health. Each entry shows a
          <span class="text-sky-400">ROZOOM:</span> note explaining which diagnostics it unlocks (e.g.
          Prometheus stack enables the metrics and latency dashboards). Install with one click, or customise
          version and preview before applying.
        </Card.Description>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <input
          type="search"
          class="h-7 w-56 rounded-md border border-border bg-background px-2 text-xs"
          placeholder="Filter by name, description, category"
          aria-label="Filter charts"
          bind:value={searchQuery}
        />
        <Button
          variant="ghost"
          size="icon"
          class="h-7 w-7"
          onclick={() => refreshReleases()}
          disabled={isLoading || offline}
        >
          <Refresh class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
        </Button>
      </div>
    </Card.Header>
  </Card.Root>

  <!-- Presets -->
  {#if !searchQuery.trim()}
    <Card.Root>
      <Card.Header class="pb-2">
        <Card.Title class="text-sm font-semibold">Install presets</Card.Title>
        <Card.Description class="text-[11px] text-muted-foreground">
          One-click bundles. Already-installed charts are skipped automatically.
        </Card.Description>
      </Card.Header>
      <Card.Content class="p-0">
        <div class="divide-y divide-border">
          {#each PRESETS as preset (preset.id)}
            {@const chartsInPreset = preset.chartIds
              .map((id) => CATALOG.find((c) => c.id === id))
              .filter((c): c is CatalogChart => Boolean(c))}
            {@const toInstall = chartsInPreset.filter((c) => !isInstalled(c))}
            {@const presetBusy =
              presetProgress?.id === preset.id && presetProgress.done < presetProgress.total}
            <div class="flex items-start gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium text-foreground">{preset.title}</span>
                  <Badge
                    variant="outline"
                    class="border-slate-500/40 bg-slate-500/10 text-slate-400 text-[10px] px-1.5 py-0"
                  >
                    {chartsInPreset.length - toInstall.length}/{chartsInPreset.length} installed
                  </Badge>
                </div>
                <p class="mt-0.5 text-xs text-muted-foreground">{preset.description}</p>
                {#if presetBusy}
                  <p class="mt-1 text-[11px] text-amber-400">
                    Installing {presetProgress?.current ?? "…"} ({presetProgress?.done ??
                      0}/{presetProgress?.total ?? 0})
                  </p>
                {/if}
              </div>
              <div class="shrink-0 pt-0.5">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                  onclick={() => handlePreset(preset)}
                  disabled={!!actionInFlight || offline || toInstall.length === 0}
                >
                  {#if presetBusy}
                    <LoadingDots />
                  {:else if toInstall.length === 0}
                    All installed
                  {:else}
                    Install {toInstall.length} chart{toInstall.length === 1 ? "" : "s"}
                  {/if}
                </Button>
              </div>
            </div>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}

  <CommandConsole {session} label={currentActionLabel} />

  {#if actionNotice}
    <div
      class="rounded-md border px-3 py-2 text-xs {actionNotice.type === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-400'}"
    >
      {actionNotice.text}
    </div>
  {/if}

  {#if !hasLoaded && isLoading}
    <div class="flex items-center justify-center py-8">
      <LoadingDots />
    </div>
  {:else if filteredCatalog.length === 0}
    <Card.Root>
      <Card.Content class="py-6 text-center text-xs text-muted-foreground">
        No charts match "<span class="text-foreground">{searchQuery}</span>".
        <button class="ml-1 text-sky-400 hover:underline" onclick={() => (searchQuery = "")}>
          Clear filter
        </button>
      </Card.Content>
    </Card.Root>
  {:else}
    {#each CATEGORIES as category}
      {@const charts = chartsByCategory(category)}
      {#if charts.length > 0}
        {@const isCollapsed = collapsedCategories.has(category)}
        <Card.Root>
          <Card.Header class="pb-2">
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left"
              onclick={() => toggleCategory(category)}
              title={isCollapsed ? "Expand" : "Collapse"}
            >
              <span class="text-xs text-muted-foreground">{isCollapsed ? "▸" : "▾"}</span>
              <Card.Title class="text-sm font-semibold">{category}</Card.Title>
              <Badge class="bg-slate-500 text-white text-[10px] px-1.5 py-0">
                {filteredCountsByCategory.get(category) ?? charts.length}
              </Badge>
            </button>
          </Card.Header>
          {#if !isCollapsed}
            <Card.Content class="p-0">
              <div class="divide-y divide-border">
                {#each charts as chart (chart.id)}
                  {@const helmManaged = isHelmInstalled(chart)}
                  {@const detected = isDetectedInCluster(chart)}
                  {@const installed = helmManaged || detected}
                  {@const installedRelease = getInstalledRelease(chart)}
                  {@const installedNamespace = installedRelease?.namespace ?? chart.namespace}
                  {@const installedReleaseName = installedRelease?.name}
                  {@const isBusy =
                    actionInFlight === chart.id || actionInFlight === `preview:${chart.id}`}
                  <div class="flex items-start gap-3 px-4 py-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-medium text-foreground">{chart.name}</span>
                        {#if helmManaged}
                          <Badge
                            variant="outline"
                            class="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px] px-1.5 py-0"
                          >
                            Installed
                          </Badge>
                        {:else if detected}
                          <Badge
                            variant="outline"
                            class="border-sky-500/40 bg-sky-500/10 text-sky-400 text-[10px] px-1.5 py-0"
                            title="Detected in cluster but not managed by Helm (e.g. minikube addon or kubectl apply)"
                          >
                            Detected
                          </Badge>
                        {:else}
                          <Badge
                            variant="outline"
                            class="border-slate-500/40 bg-slate-500/10 text-slate-400 text-[10px] px-1.5 py-0"
                          >
                            Not installed
                          </Badge>
                        {/if}
                        <Badge
                          variant="outline"
                          class="border-border/60 bg-muted/30 text-[10px] px-1.5 py-0 text-muted-foreground"
                          title={`Maintained by ${maintainerFor(chart)}`}
                        >
                          {maintainerFor(chart)}
                        </Badge>
                      </div>
                      <p class="mt-0.5 text-xs text-muted-foreground">{chart.description}</p>
                      <p
                        class="mt-0.5 text-[11px] text-sky-400/80"
                        title="Diagnostics that become available in ROZOOM once this chart is installed"
                      >
                        ROZOOM: {chart.scoring}
                      </p>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <a
                          href={chart.repoUrl}
                          class="text-sky-400/70 hover:text-sky-300 hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open ${chart.repoName} repository`}
                        >
                          {chart.repoName} repo
                        </a>
                        <span class="text-muted-foreground/60">·</span>
                        <span
                          class="text-muted-foreground"
                          title={installed && installedNamespace !== chart.namespace
                            ? `Detected in namespace "${installedNamespace}"; catalog default is "${chart.namespace}"`
                            : undefined}
                        >
                          ns: {installedNamespace}
                        </span>
                        {#if installedReleaseName && installedReleaseName !== chart.releaseName}
                          <span class="text-muted-foreground/60">·</span>
                          <span
                            class="text-muted-foreground"
                            title={`Release installed as "${installedReleaseName}" (catalog default would be "${chart.releaseName}")`}
                          >
                            release: {installedReleaseName}
                          </span>
                        {/if}
                        {#if !installed}
                          <span class="text-muted-foreground/60">·</span>
                          <input
                            type="text"
                            list={`versions-${chart.id}`}
                            class="h-6 w-28 rounded border border-border bg-background px-1.5 text-[11px]"
                            placeholder="latest"
                            aria-label={`${chart.name} version`}
                            value={chartVersions[chart.id] ?? ""}
                            oninput={(e) => {
                              const v = e.currentTarget.value;
                              chartVersions = { ...chartVersions, [chart.id]: v };
                              persistVersions();
                            }}
                            onfocus={() => void ensureVersionsLoaded(chart)}
                            title="Pin a chart version (semver). Click to see available versions from helm search repo. Leave empty for latest."
                          />
                          <datalist id={`versions-${chart.id}`}>
                            {#each chartVersionsCache[chart.id] ?? [] as v (v.version)}
                              <option value={v.version}
                                >{v.version}{v.appVersion ? ` (app ${v.appVersion})` : ""}</option
                              >
                            {/each}
                          </datalist>
                          {#if loadingVersionsFor.has(chart.id)}
                            <span class="text-[10px] text-muted-foreground">loading…</span>
                          {/if}
                        {/if}
                      </div>
                    </div>
                    <div class="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                      {#if helmManaged}
                        {@const chartUi = uiConfigFor(chart)}
                        {@const uiForwarded =
                          chartUi !== null &&
                          $activePortForwards[uiForwardKey(chart, chartUi, installedRelease)]
                            ?.isRunning === true}
                        {#if chartUi}
                          <div class="flex gap-1.5">
                            <div class="inline-flex items-center rounded border border-sky-500/30">
                              <Button
                                variant="ghost"
                                size="sm"
                                class="h-7 rounded-r-none border-r border-sky-500/30 text-xs text-sky-400 hover:bg-sky-500/10"
                                onclick={() => void openChartUi(chart, "in-app")}
                                disabled={!!actionInFlight || offline || openingUiFor === chart.id}
                                title={`Port-forward svc/${resolveServiceName(chartUi, installedRelease?.name ?? chart.releaseName)}:${chartUi.remotePort} (ns ${resolveUiNamespace(chartUi, installedRelease, chart)}) and open in the built-in browser`}
                              >
                                {#if openingUiFor === chart.id}<LoadingDots
                                  />{:else}{chartUi.label}{/if}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                class="h-7 rounded-l-none text-xs text-sky-400 hover:bg-sky-500/10"
                                onclick={() => void openChartUi(chart, "external")}
                                disabled={!!actionInFlight || offline || openingUiFor === chart.id}
                                title="Open in system default browser"
                              >
                                External
                              </Button>
                            </div>
                            {#if uiForwarded}
                              <Button
                                variant="ghost"
                                size="sm"
                                class="h-7 text-xs text-muted-foreground"
                                onclick={() => void stopChartUi(chart)}
                                title="Stop the port-forward"
                              >
                                Stop
                              </Button>
                            {/if}
                          </div>
                        {/if}
                        <div class="flex gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            class="h-7 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                            onclick={() => {
                              const next = new URL($page.url);
                              next.searchParams.set("workload", "helm");
                              void goto(next.pathname + next.search);
                            }}
                            title="Open Helm page, view releases and history"
                          >
                            View release
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            class="h-7 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                            onclick={() => handleUninstall(chart)}
                            disabled={!!actionInFlight || offline}
                          >
                            {#if isBusy}<LoadingDots />{:else}Uninstall{/if}
                          </Button>
                        </div>
                      {:else if !installed}
                        <div class="flex gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            class="h-7 text-xs"
                            onclick={() => handlePreview(chart)}
                            disabled={!!actionInFlight || offline}
                            title="Render chart with --dry-run without touching the cluster"
                          >
                            {#if actionInFlight === `preview:${chart.id}`}
                              <LoadingDots />
                            {:else}
                              Preview
                            {/if}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            class="h-7 text-xs"
                            onclick={() => openValuesEditor(chart)}
                            disabled={!!actionInFlight || offline}
                            title="Edit values.yaml (starts from helm show values defaults)"
                          >
                            Customize
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            class="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                            onclick={() => handleInstall(chart)}
                            disabled={!!actionInFlight || offline}
                          >
                            {#if actionInFlight === chart.id}
                              <LoadingDots />
                            {:else}
                              Install
                            {/if}
                          </Button>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </Card.Content>
          {/if}
        </Card.Root>
      {/if}
    {/each}
  {/if}
</div>

{#if previewDialog}
  <button
    type="button"
    class="fixed inset-0 z-[150] bg-black/40"
    aria-label="Close preview"
    onclick={closePreview}
  ></button>
  <div
    class="fixed inset-y-6 right-6 z-[160] flex w-[min(70vw,800px)] flex-col rounded-lg border bg-background shadow-2xl"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">
          Preview: {previewDialog.chart.name}
          <span class="text-xs font-normal text-muted-foreground">
            ({previewDialog.version}) · ns {previewDialog.chart.namespace}
          </span>
        </div>
        <div class="text-[11px] text-muted-foreground">
          Output of <code>helm upgrade --install --dry-run</code>. Nothing has been applied yet.
        </div>
      </div>
      <Button variant="ghost" size="sm" onclick={closePreview}>Close</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4">
      {#if previewDialog.loading}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <LoadingDots /> Running dry-run…
        </div>
      {:else if previewDialog.error}
        <div
          class="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
        >
          {previewDialog.error}
        </div>
      {:else}
        <pre
          class="whitespace-pre-wrap rounded bg-slate-950/70 p-3 text-[11px] font-mono text-slate-300">{previewDialog.output}</pre>
      {/if}
    </div>
    <div class="flex items-center justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" size="sm" onclick={closePreview}>Cancel</Button>
      <Button
        size="sm"
        class="bg-emerald-600 text-white hover:bg-emerald-700"
        disabled={previewDialog.loading || Boolean(previewDialog.error)}
        onclick={() => void confirmInstallFromPreview()}
      >
        Install
      </Button>
    </div>
  </div>
{/if}

{#if valuesDialog}
  <button
    type="button"
    class="fixed inset-0 z-[150] bg-black/40"
    aria-label="Close values editor"
    onclick={closeValuesEditor}
  ></button>
  <div
    class="fixed inset-y-6 right-6 z-[160] flex w-[min(70vw,800px)] flex-col rounded-lg border bg-background shadow-2xl"
  >
    <div class="flex items-center justify-between border-b px-4 py-3">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold">
          Customize values: {valuesDialog.chart.name}
          <span class="text-xs font-normal text-muted-foreground">
            ({valuesDialog.version}) · ns {valuesDialog.chart.namespace}
          </span>
        </div>
        <div class="text-[11px] text-muted-foreground">
          Prefilled from <code>helm show values</code>. Your edits are passed via
          <code>--values &lt;tmpfile&gt;</code>.
        </div>
      </div>
      <Button variant="ghost" size="sm" onclick={closeValuesEditor}>Close</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4">
      {#if valuesDialog.loadingDefaults}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <LoadingDots /> Loading chart defaults…
        </div>
      {:else}
        {#if valuesDialog.error && !valuesDialog.installing}
          <div
            class="mb-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
          >
            {valuesDialog.error}
          </div>
        {/if}
        <div class="min-h-[60vh] rounded border border-slate-800 bg-slate-950/70 overflow-hidden">
          <YamlEditor
            value={valuesDialog.yaml}
            readonly={valuesDialog.installing}
            onChange={(v) => {
              if (valuesDialog) valuesDialog = { ...valuesDialog, yaml: v };
            }}
          />
        </div>
      {/if}
    </div>
    <div class="flex items-center justify-between border-t px-4 py-3">
      <Button
        variant="ghost"
        size="sm"
        onclick={resetValuesToDefaults}
        disabled={valuesDialog.loadingDefaults || valuesDialog.installing}
        title="Reset to chart defaults"
      >
        Reset to defaults
      </Button>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onclick={closeValuesEditor}
          disabled={valuesDialog.installing}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          class="bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={valuesDialog.loadingDefaults || valuesDialog.installing}
          onclick={() => void installWithCustomValues()}
        >
          {#if valuesDialog.installing}<LoadingDots />{/if}
          Install with these values
        </Button>
      </div>
    </div>
  </div>
{/if}
