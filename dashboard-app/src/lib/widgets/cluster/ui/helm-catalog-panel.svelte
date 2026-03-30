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
    type HelmListedRelease,
  } from "$shared/api/helm";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";
  import { Refresh } from "$shared/ui/icons";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { markSectionRefreshed } from "$shared/lib/section-enter-refresh";

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
    installFn?: (clusterId: string) => Promise<{ success: boolean; error?: string }>;
  }

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
      installFn: (cid) => installPrometheusStack(cid),
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
      installFn: (cid) => installKubeStateMetrics(cid),
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
      installFn: (cid) => installMetricsServer(cid),
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
      installFn: (cid) => installNodeExporter(cid),
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
      installFn: (cid) => installKubescape(cid),
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
      installFn: (cid) => installTrivyOperator(cid),
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
      installFn: (cid) => installKubeArmor(cid),
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
      description: "Runtime threat detection - detects anomalous activity in containers and hosts via syscall monitoring.",
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
      description: "Policy engine for K8s - validate, mutate, and generate resources. Enforce best practices on deploy.",
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
      description: "Encrypt Secrets for safe storage in Git. One-way encryption with cluster-side decryption only.",
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
      installFn: (cid) => installVelero(cid),
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
      description: "Auto-restarts Deployments/StatefulSets/DaemonSets when ConfigMaps or Secrets change.",
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
      description: "Log aggregation system by Grafana. Lightweight alternative to ELK, pairs with Prometheus.",
      scoring: "Log collection, error correlation, audit trail.",
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
      description: "Log collector agent that ships pod logs to Loki. Runs as DaemonSet on every node.",
      scoring: "Log shipping, pod log visibility, debug support.",
    },
    {
      id: "envoy-gateway",
      name: "envoy-gateway",
      releaseName: "envoy-gateway",
      namespace: "envoy-gateway-system",
      repoName: "envoy-gateway",
      repoUrl: "https://gateway-helm.envoyproxy.io",
      chart: "envoy-gateway/gateway-helm",
      category: "Networking",
      description: "Kubernetes Gateway API implementation powered by Envoy proxy. Replaces deprecated ingress-nginx.",
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
      description: "Event-driven autoscaling for K8s workloads - scale on HTTP traffic, queues, cron, custom metrics.",
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
      description: "Evicts pods to rebalance across nodes based on policies (affinity violations, node utilization).",
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
      description: "Real-time cost monitoring for K8s. Cost allocation by namespace, label, and workload.",
      scoring: "Cost visibility, resource efficiency, budget tracking.",
    },
    {
      id: "external-secrets",
      name: "external-secrets-operator",
      releaseName: "external-secrets",
      namespace: "external-secrets",
      repoName: "external-secrets",
      repoUrl: "https://charts.external-secrets.io",
      chart: "external-secrets/external-secrets",
      category: "Security & Compliance",
      description: "Sync secrets from Vault, AWS SM, GCP SM, Azure KV to K8s Secrets automatically.",
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
      description: "Vendor-neutral telemetry pipeline - collect, process, and export traces, metrics, and logs.",
      scoring: "Distributed tracing, metrics pipeline, log forwarding.",
    },
    {
      id: "ingress-nginx",
      name: "ingress-nginx",
      releaseName: "ingress-nginx",
      namespace: "ingress-nginx",
      repoName: "ingress-nginx",
      repoUrl: "https://kubernetes.github.io/ingress-nginx",
      chart: "ingress-nginx/ingress-nginx",
      category: "Networking",
      description: "Production-grade Ingress controller powered by NGINX. Most widely used K8s ingress.",
      scoring: "Traffic routing, TLS termination, rate limiting.",
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
      description: "Declarative GitOps continuous delivery for K8s. Sync cluster state from Git repositories.",
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
      description: "GitOps toolkit for K8s - keeps clusters in sync with Git sources, Helm charts, and OCI artifacts.",
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
      description: "Expose Prometheus metrics as custom/external metrics for HPA. Scale on any Prometheus query.",
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

  function isHelmInstalled(chart: CatalogChart): boolean {
    return releases.some(
      (r) =>
        r.name === chart.releaseName ||
        (r.chart || "").toLowerCase().startsWith(chart.id),
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
      (r) =>
        r.name === chart.releaseName ||
        (r.chart || "").toLowerCase().startsWith(chart.id),
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
          deploymentNames = new Set(
            (json.items ?? []).map((d) => d.metadata.name.toLowerCase()),
          );
        } catch {
          deploymentNames = new Set();
        }
      }
    } finally {
      isLoading = false;
      hasLoaded = true;
    }
  }

  async function handleInstall(chart: CatalogChart) {
    if (actionInFlight) return;
    actionInFlight = chart.id;
    actionNotice = null;

    try {
      let result: { success: boolean; error?: string };
      if (chart.installFn) {
        result = await chart.installFn(clusterId);
      } else {
        result = await installOrUpgradeHelmRelease(clusterId, {
          releaseName: chart.releaseName,
          chart: chart.chart,
          namespace: chart.namespace,
          createNamespace: true,
        });
      }

      if (result.success) {
        actionNotice = { type: "success", text: `${chart.name} installed successfully` };
      } else {
        actionNotice = {
          type: "error",
          text: result.error ?? `Failed to install ${chart.name}`,
        };
      }
      await refreshReleases();
    } catch (err) {
      actionNotice = {
        type: "error",
        text: err instanceof Error ? err.message : `Failed to install ${chart.name}`,
      };
    } finally {
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

    try {
      const result = await uninstallHelmRelease(clusterId, {
        releaseName,
        namespace,
      });

      if (result.success) {
        actionNotice = { type: "success", text: `${chart.name} uninstalled successfully` };
      } else {
        actionNotice = {
          type: "error",
          text: result.error ?? `Failed to uninstall ${chart.name}`,
        };
      }
      await refreshReleases();
    } catch (err) {
      actionNotice = {
        type: "error",
        text: err instanceof Error ? err.message : `Failed to uninstall ${chart.name}`,
      };
    } finally {
      actionInFlight = null;
    }
  }

  function chartsByCategory(category: CatalogCategory): CatalogChart[] {
    return CATALOG.filter((c) => c.category === category);
  }

  $effect(() => {
    if (clusterId && !offline && !hasLoaded && !isLoading) {
      refreshReleases().then(() => markSectionRefreshed(`helmcatalog:${clusterId}`));
    }
  });
</script>

<div class="flex flex-col gap-4">
  <Card.Root>
    <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
      <div>
        <Card.Title class="text-base font-semibold">Helm Catalog</Card.Title>
        <Card.Description class="text-xs text-muted-foreground">
          Curated charts to improve cluster health and ROZOOM score. Install with one click.
        </Card.Description>
      </div>
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        onclick={() => refreshReleases()}
        disabled={isLoading || offline}
      >
        <Refresh class="h-3.5 w-3.5 {isLoading ? 'animate-spin' : ''}" />
      </Button>
    </Card.Header>
  </Card.Root>

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
  {:else}
    {#each CATEGORIES as category}
      {@const charts = chartsByCategory(category)}
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="text-sm font-semibold">{category}</Card.Title>
        </Card.Header>
        <Card.Content class="p-0">
          <div class="divide-y divide-border">
            {#each charts as chart (chart.id)}
              {@const helmManaged = isHelmInstalled(chart)}
              {@const detected = isDetectedInCluster(chart)}
              {@const installed = helmManaged || detected}
              {@const isBusy = actionInFlight === chart.id}
              <div class="flex items-start gap-3 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
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
                  </div>
                  <p class="mt-0.5 text-xs text-muted-foreground">{chart.description}</p>
                  <p class="mt-0.5 text-[11px] text-sky-400/80">
                    ROZOOM: {chart.scoring}
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1.5 pt-0.5">
                  {#if helmManaged}
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 text-xs text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                      onclick={() => handleUninstall(chart)}
                      disabled={!!actionInFlight || offline}
                    >
                      {#if isBusy}
                        <LoadingDots />
                      {:else}
                        Uninstall
                      {/if}
                    </Button>
                  {:else if !installed}
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                      onclick={() => handleInstall(chart)}
                      disabled={!!actionInFlight || offline}
                    >
                      {#if isBusy}
                        <LoadingDots />
                      {:else}
                        Install
                      {/if}
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
