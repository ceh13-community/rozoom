<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    markMetricsSourcesUnavailable,
    metricsSourcesConfig,
    metricsSourcesState,
    runMetricsSourcesCheck,
    startMetricsSourcesPolling,
    stopMetricsSourcesPolling,
  } from "$features/metrics-sources";
  import type { MetricsSourceCheck } from "$features/metrics-sources";
  import {
    installKubeStateMetrics,
    installMetricsServer,
    installNodeExporter,
  } from "$shared/api/helm";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import InlineNotice from "$shared/ui/inline-notice.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  const metricsState = $derived($metricsSourcesState[clusterId]);
  const summary = $derived(metricsState?.summary ?? null);
  const checks = $derived(metricsState?.checks ?? []);
  const config = $derived($metricsSourcesConfig);
  const availableCount = $derived(checks.filter((check) => check.status === "available").length);
  const unreachableCount = $derived(checks.filter((check) => check.status === "unreachable").length);
  const missingCount = $derived(checks.filter((check) => check.status === "not_found").length);

  let expandedIds = $state<string[]>([]);
  let checkingNow = $state(false);
  let installAction = $state<Record<string, { status: "idle" | "working" | "success" | "error"; message?: string }>>({});
  let pageVisible = $state(true);
  let refreshRequestId = 0;
  let installRequestId = 0;
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const statusStyles: Record<string, string> = {
    available: "bg-emerald-500",
    unreachable: "bg-amber-500",
    not_found: "bg-rose-600",
  };

  const statusIcons: Record<string, string> = {
    available: "✅",
    unreachable: "🟠",
    not_found: "❌",
  };

  function collectErrors(check: MetricsSourceCheck): string[] {
    return check.endpoints
      .map((endpoint) => endpoint.error?.trim() ?? "")
      .filter((value) => value.length > 0);
  }

  function detectIssueTags(check: MetricsSourceCheck): string[] {
    const text = collectErrors(check).join(" | ").toLowerCase();
    if (!text) return [];
    const tags = new Set<string>();

    if (
      text.includes("x509") ||
      text.includes("tls") ||
      text.includes("certificate") ||
      text.includes("ip sans")
    ) {
      tags.add("TLS/SAN");
    }
    if (text.includes("forbidden") || text.includes("unauthorized") || text.includes("rbac")) {
      tags.add("RBAC");
    }
    if (text.includes("timeout")) {
      tags.add("Timeout");
    }
    if (text.includes("notfound") || text.includes("404") || text.includes("not found")) {
      tags.add("NotFound");
    }
    if (
      text.includes("prometheus text not detected") ||
      text.includes("did not return prometheus")
    ) {
      tags.add("Payload");
    }
    if (
      text.includes("connection refused") ||
      text.includes("no route to host") ||
      text.includes("dial tcp")
    ) {
      tags.add("Network");
    }
    if (text.includes("reports ") || text.includes("no node-exporter pod/metrics for node")) {
      tags.add("Coverage");
    }

    return [...tags];
  }

  function formatDate(value: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function toggleDetails(id: string) {
    expandedIds = expandedIds.includes(id)
      ? expandedIds.filter((item) => item !== id)
      : [...expandedIds, id];
  }

  function runNow() {
    if (!clusterId || checkingNow) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    checkingNow = true;
    runMetricsSourcesCheck(activeClusterId, { force: true }).finally(() => {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      checkingNow = false;
    });
  }

  function describeCheck(check: MetricsSourceCheck) {
    return `${check.title}: ${check.message}`;
  }

  function isHelmInstallable(check: MetricsSourceCheck): boolean {
    return (
      check.id === "metrics-server" ||
      check.id === "kube-state-metrics" ||
      check.id === "node-exporter"
    );
  }

  function isMissing(check: MetricsSourceCheck): boolean {
    return check.status === "not_found";
  }

  async function installSource(check: MetricsSourceCheck) {
    if (!clusterId || !isHelmInstallable(check) || !isMissing(check)) return;
    if (installAction[check.id]?.status === "working") return;
    const requestId = ++installRequestId;
    const activeClusterId = clusterId;

    installAction = {
      ...installAction,
      [check.id]: { status: "working" },
    };

    try {
      const result =
        check.id === "metrics-server"
          ? await installMetricsServer(activeClusterId)
          : check.id === "kube-state-metrics"
            ? await installKubeStateMetrics(activeClusterId)
            : await installNodeExporter(activeClusterId);
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;

      if (!result.success) {
        const message = result.error?.trim() || `Failed to install ${check.title}`;
        installAction = {
          ...installAction,
          [check.id]: { status: "error", message },
        };
        toast.error(`${check.title}: ${message}`);
        return;
      }
      const refreshed = await runMetricsSourcesCheck(activeClusterId, { force: true });
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const refreshedCheck = refreshed.checks.find((item) => item.id === check.id);
      if (!refreshedCheck || refreshedCheck.status !== "available") {
        const message =
          refreshedCheck?.status === "unreachable"
            ? `${check.title} install command completed, but endpoint is still unreachable`
            : `${check.title} install command completed, but source is still not detected`;
        installAction = {
          ...installAction,
          [check.id]: { status: "error", message },
        };
        toast.error(message);
        return;
      }

      installAction = {
        ...installAction,
        [check.id]: { status: "success", message: "Installed and verified." },
      };
      toast.success(`${check.title} installed and verified.`);
    } catch (error) {
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const message = error instanceof Error ? error.message : `Failed to install ${check.title}`;
      installAction = {
        ...installAction,
        [check.id]: { status: "error", message },
      };
      toast.error(`${check.title}: ${message}`);
    }
  }

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    installRequestId += 1;
  });

  function syncPageVisibility() {
    if (typeof document === "undefined") {
      pageVisible = true;
      return;
    }
    pageVisible = document.visibilityState !== "hidden";
  }

  onMount(() => {
    syncPageVisibility();
    const handleVisibility = () => {
      syncPageVisibility();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  $effect(() => {
    if (!clusterId) return;

    if (offline) {
      stopMetricsSourcesPolling(clusterId);
      markMetricsSourcesUnavailable(clusterId, "Metrics sources unavailable: cluster is offline");
      return;
    }

    if (!autoDiagnosticsEnabled) {
      stopMetricsSourcesPolling(clusterId);
      return;
    }

    if (!pageVisible) {
      stopMetricsSourcesPolling(clusterId);
      return;
    }

    startMetricsSourcesPolling(clusterId);

    return () => {
      stopMetricsSourcesPolling(clusterId);
    };
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Availability checks for kubelet/cAdvisor, metrics-server, kube-state-metrics, and node-exporter."
        >
          Metrics Sources Status
        </h2>
        {#if summary}
          <Badge class="text-white {summary.status === "ok" ? "bg-emerald-500" : "bg-amber-500"}">
            {summary.status}
          </Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Metrics sources info"
              title="About metrics sources"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[440px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Metrics sources</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">metrics-server:</span>
                provides resource metrics API used by HPA and `kubectl top`.
              </p>
              <p>
                <span class="font-medium text-foreground">kube-state-metrics:</span>
                exposes Kubernetes object state as Prometheus metrics.
              </p>
              <p>
                <span class="font-medium text-foreground">node-exporter:</span>
                exposes host-level node metrics (CPU, memory, filesystem, network).
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubernetes-sigs/metrics-server"
                target="_blank"
                rel="noreferrer noopener"
              >
                metrics-server GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubernetes/kube-state-metrics"
                target="_blank"
                rel="noreferrer noopener"
              >
                kube-state-metrics GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://github.com/prometheus/node_exporter"
                target="_blank"
                rel="noreferrer noopener"
              >
                node-exporter GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="/docs/metrics-sources-hardening.md"
                target="_blank"
                rel="noreferrer noopener"
              >
                Metrics hardening runbook
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <Button variant="outline" onclick={runNow} loading={checkingNow} loadingLabel="Refreshing">
        <Refresh class="mr-2 h-4 w-4" /> Refresh status
      </Button>
    </div>
    <p class="text-sm text-muted-foreground">
      Kubelet, metrics-server, kube-state-metrics, and node-exporter availability via API proxy.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
    {#if summary?.status === "unavailable"}
      <InlineNotice variant="destructive" title="Metrics sources unavailable">
        {summary?.message ?? "Unable to verify metrics sources."}
      </InlineNotice>
    {/if}

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last check">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock4 class="h-4 w-4" /> Last check
        </div>
        <p class="text-sm font-medium">{formatDate(summary?.lastRunAt ?? null)}</p>
        <p class="text-xs text-muted-foreground">
          Cache TTL: {Math.round(config.cacheTtlMs / 1000)}s · Polling every
          {Math.round(config.scheduleMs / 1000)}s
        </p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Summary">
        <p class="text-sm font-semibold">{summary?.message ?? "-"}</p>
        <p class="text-xs text-muted-foreground">
          {checks.length} sources checked · Available {availableCount} · Unreachable {unreachableCount} · Not found {missingCount}
        </p>
      </DiagnosticSummaryCard>
    </div>

    <TableSurface maxHeightClass="">
      <Table.Table>
        <Table.TableHeader>
          <Table.TableRow>
            <Table.TableHead>Source</Table.TableHead>
            <Table.TableHead>Status</Table.TableHead>
            <Table.TableHead>Last check</Table.TableHead>
            <Table.TableHead>Details</Table.TableHead>
            <Table.TableHead>Actions</Table.TableHead>
          </Table.TableRow>
        </Table.TableHeader>
        <Table.TableBody>
          {#if checks.length === 0}
            <Table.TableRow>
              <Table.TableCell colspan={5} class="text-center">
                <TableEmptyState message="No results for the current filter." />
              </Table.TableCell>
            </Table.TableRow>
          {:else}
            {#each checks as check}
              <Table.TableRow class={check.status === "available" ? "" : "bg-amber-500/5"}>
                <Table.TableCell>
                  <p class="text-sm font-medium">{check.title}</p>
                  <p class="text-xs text-muted-foreground">{describeCheck(check)}</p>
                  {#if check.status !== "available" && detectIssueTags(check).length > 0}
                    <div class="mt-1 flex flex-wrap gap-1">
                      {#each detectIssueTags(check) as tag}
                        <Badge variant="outline" class="text-[10px] leading-4">
                          {tag}
                        </Badge>
                      {/each}
                    </div>
                  {/if}
                  {#if check.status !== "available" && check.endpoints.some((endpoint) => endpoint.error)}
                    <p class="mt-1 text-xs text-amber-600">
                      Last error: {check.endpoints.find((endpoint) => endpoint.error)?.error}
                    </p>
                  {/if}
                </Table.TableCell>
                <Table.TableCell>
                  <Badge class="text-white {statusStyles[check.status]} inline-flex items-center gap-1">
                    <span>{statusIcons[check.status]}</span>
                    <span>{check.status}</span>
                  </Badge>
                </Table.TableCell>
                <Table.TableCell>{formatDate(check.checkedAt)}</Table.TableCell>
                <Table.TableCell>
                  <Button size="sm" variant="outline" onclick={() => toggleDetails(check.id)}>
                    {expandedIds.includes(check.id) ? "Hide" : "Details"}
                  </Button>
                </Table.TableCell>
                <Table.TableCell>
                  {#if isHelmInstallable(check) && isMissing(check)}
                    <div class="flex flex-col gap-1">
                      <Button
                        size="sm"
                        onclick={() => installSource(check)}
                        loading={installAction[check.id]?.status === "working"}
                        loadingLabel="Installing"
                      >
                        <span>Install (Helm)</span>
                      </Button>
                      {#if installAction[check.id]?.status === "error"}
                        <span class="text-xs text-rose-600">{installAction[check.id]?.message}</span>
                      {/if}
                    </div>
                  {:else}
                    <span class="text-xs text-muted-foreground">-</span>
                  {/if}
                </Table.TableCell>
              </Table.TableRow>
              {#if expandedIds.includes(check.id)}
                <Table.TableRow>
                  <Table.TableCell colspan={5} class="bg-muted/40">
                    <div class="space-y-2 text-xs text-muted-foreground">
                      {#each check.endpoints as endpoint}
                        <div>
                          <span class="font-mono">{endpoint.url || "(unknown endpoint)"}</span>
                          {#if endpoint.error}
                            <span class="text-destructive"> - {endpoint.error}</span>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </Table.TableCell>
                </Table.TableRow>
              {/if}
            {/each}
          {/if}
        </Table.TableBody>
      </Table.Table>
    </TableSurface>
  </Card.Content>
</Card.Root>
