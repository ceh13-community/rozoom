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
  import { humanizeMetricsError } from "$features/metrics-sources/model/humanize";
  import {
    runPreflight,
    type PreflightReport,
    type PreflightCheck,
  } from "$features/metrics-sources/model/preflight";
  import { SOURCE_DEPENDENTS, getDependentsFor } from "$features/metrics-sources/model/dependents";
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
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import InlineNotice from "$shared/ui/inline-notice.svelte";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import CircleHelp from "@lucide/svelte/icons/circle-help";
  import Gauge from "@lucide/svelte/icons/gauge";
  import Download from "@lucide/svelte/icons/download";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type TabKey = "overview" | "dependents" | "troubleshooting";

  const metricsState = $derived($metricsSourcesState[clusterId]);
  const summary = $derived(metricsState?.summary ?? null);
  const checks = $derived(metricsState?.checks ?? []);
  const config = $derived($metricsSourcesConfig);
  const availableCount = $derived(checks.filter((c) => c.status === "available").length);
  const unreachableCount = $derived(checks.filter((c) => c.status === "unreachable").length);
  const missingCount = $derived(checks.filter((c) => c.status === "not_found").length);

  let activeTab = $state<TabKey>("overview");
  let expandedIds = $state<string[]>([]);
  let checkingNow = $state(false);
  let installAction = $state<
    Record<string, { status: "idle" | "working" | "success" | "error"; message?: string }>
  >({});
  const installSession = createConsoleSession();
  let installLabel = $state("Metrics source");
  let pageVisible = $state(true);
  let refreshRequestId = 0;
  let installRequestId = 0;

  let preflight = $state<PreflightReport | null>(null);
  let preflightRunning = $state(false);

  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const statusStyles: Record<string, string> = {
    available: "bg-emerald-500",
    unreachable: "bg-amber-500",
    not_found: "bg-rose-600",
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
    )
      tags.add("TLS/SAN");
    if (text.includes("forbidden") || text.includes("unauthorized") || text.includes("rbac"))
      tags.add("RBAC");
    if (text.includes("timeout")) tags.add("Timeout");
    if (text.includes("notfound") || text.includes("404") || text.includes("not found"))
      tags.add("NotFound");
    if (text.includes("prometheus text not detected") || text.includes("did not return prometheus"))
      tags.add("Payload");
    if (
      text.includes("connection refused") ||
      text.includes("no route to host") ||
      text.includes("dial tcp")
    )
      tags.add("Network");
    if (text.includes("reports ") || text.includes("no node-exporter pod/metrics for node"))
      tags.add("Coverage");
    return [...tags];
  }

  function firstHumanized(check: MetricsSourceCheck) {
    const err = collectErrors(check)[0];
    if (!err) return null;
    return humanizeMetricsError(err, check.id);
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

    installAction = { ...installAction, [check.id]: { status: "working" } };
    installLabel = `Installing ${check.title}`;
    installSession.start();
    const onOutput = (chunk: string) => installSession.append(chunk);

    try {
      const result =
        check.id === "metrics-server"
          ? await installMetricsServer(activeClusterId, undefined, undefined, onOutput)
          : check.id === "kube-state-metrics"
            ? await installKubeStateMetrics(activeClusterId, undefined, onOutput)
            : await installNodeExporter(activeClusterId, undefined, onOutput);
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;

      if (!result.success) {
        const message = result.error?.trim() || `Failed to install ${check.title}`;
        installAction = { ...installAction, [check.id]: { status: "error", message } };
        toast.error(`${check.title}: ${message}`);
        installSession.fail();
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
        installAction = { ...installAction, [check.id]: { status: "error", message } };
        toast.error(message);
        installSession.fail();
        return;
      }

      installAction = {
        ...installAction,
        [check.id]: { status: "success", message: "Installed and verified." },
      };
      toast.success(`${check.title} installed and verified.`);
      installSession.succeed();
    } catch (error) {
      if (requestId !== installRequestId || activeClusterId !== clusterId) return;
      const message = error instanceof Error ? error.message : `Failed to install ${check.title}`;
      installAction = { ...installAction, [check.id]: { status: "error", message } };
      toast.error(`${check.title}: ${message}`);
      installSession.fail();
    }
  }

  async function doPreflight() {
    if (preflightRunning) return;
    preflightRunning = true;
    try {
      preflight = await runPreflight(clusterId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      preflightRunning = false;
    }
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function gotoAlerts() {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "alertshub");
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function downloadDiagnosticBundle() {
    const payload = {
      generatedAt: new Date().toISOString(),
      clusterId,
      summary,
      checks: checks.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        message: c.message,
        checkedAt: c.checkedAt,
        endpoints: c.endpoints,
        humanized: firstHumanized(c),
      })),
      preflight,
      dependents: SOURCE_DEPENDENTS,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metrics-sources-diagnostic-${clusterId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function preflightIconColor(status: PreflightCheck["status"]): string {
    return status === "ok"
      ? "text-emerald-400"
      : status === "warn"
        ? "text-amber-400"
        : status === "fail"
          ? "text-rose-400"
          : "text-slate-500";
  }

  const cliTestCommand: Record<string, string> = {
    "metrics-server": "kubectl top nodes\nkubectl top pods -A",
    "kube-state-metrics":
      "kubectl port-forward -n monitoring svc/kube-state-metrics 8080:8080\n# then: curl -s http://localhost:8080/metrics | grep kube_deployment_status_replicas | head -5",
    "node-exporter":
      "kubectl get ds -A -l app.kubernetes.io/name=node-exporter\n# exec into a pod and: curl -s localhost:9100/metrics | grep node_cpu_seconds_total | head -3",
    "kubelet-cadvisor":
      "kubectl get --raw /api/v1/nodes/$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')/proxy/metrics/cadvisor | head -20",
  };

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
    installRequestId += 1;
    preflight = null;
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
    const handleVisibility = () => syncPageVisibility();
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
          <Badge class="text-white {summary.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'}">
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
          <Popover.Content class="w-[460px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Why these four sources matter</p>
            <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
              <li>
                <span class="text-foreground">metrics-server</span>: without it,
                <code>kubectl top</code>
                fails and HPA cannot scale (shows <code>&lt;unknown&gt;</code>).
              </li>
              <li>
                <span class="text-foreground">kube-state-metrics</span>: without it, Grafana
                Kubernetes dashboards go blank and most kube-prometheus-stack alerts stop firing.
              </li>
              <li>
                <span class="text-foreground">node-exporter</span>: without it, you lose node-level
                disk / network / CPU metrics and NodeFilesystem alerts.
              </li>
              <li>
                <span class="text-foreground">kubelet / cAdvisor</span>: embedded in kubelet.
                Without it, no per-container CPU / memory / network metrics.
              </li>
            </ul>
            <div class="flex flex-wrap gap-3 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubernetes-sigs/metrics-server"
                target="_blank"
                rel="noreferrer noopener">metrics-server</a
              >
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubernetes/kube-state-metrics"
                target="_blank"
                rel="noreferrer noopener">kube-state-metrics</a
              >
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/prometheus/node_exporter"
                target="_blank"
                rel="noreferrer noopener">node-exporter</a
              >
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" onclick={runNow} loading={checkingNow} loadingLabel="Refreshing">
          <Refresh class="mr-2 h-4 w-4" /> Refresh status
        </Button>
        <Button variant="outline" onclick={downloadDiagnosticBundle} disabled={checks.length === 0}>
          <Download class="mr-2 h-4 w-4" /> Export diagnostic
        </Button>
        <Button variant="ghost" onclick={gotoAlerts} title="Related alerts">
          <ExternalLink class="mr-2 h-4 w-4" /> Alerts Hub
        </Button>
      </div>
    </div>
    <p class="text-sm text-muted-foreground">
      Kubelet, metrics-server, kube-state-metrics, and node-exporter availability via API proxy.
    </p>

    <div class="flex items-center gap-1 border-b border-border mt-1">
      {#each [{ k: "overview", label: "Overview" }, { k: "dependents", label: "Dependents" }, { k: "troubleshooting", label: "Troubleshooting" }] as tab (tab.k)}
        <button
          type="button"
          class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
          onclick={() => (activeTab = tab.k as TabKey)}
        >
          {tab.label}
          {#if tab.k === "overview" && missingCount + unreachableCount > 0}
            <span class="ml-1 text-[10px] text-rose-400">({missingCount + unreachableCount})</span>
          {/if}
        </button>
      {/each}
    </div>
  </Card.Header>
  <Card.Content class="space-y-4">
    {#if summary?.status === "unavailable"}
      <InlineNotice variant="destructive" title="Metrics sources unavailable">
        {summary?.message ?? "Unable to verify metrics sources."}
      </InlineNotice>
    {/if}

    {#if activeTab === "overview"}
      {#if checks.length === 0 || (missingCount === checks.length && checks.length > 0)}
        <div class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-2">
          <div class="flex items-start gap-3">
            <Gauge class="h-6 w-6 text-sky-400 shrink-0 mt-0.5" />
            <div class="space-y-2">
              <p class="text-sm font-semibold text-foreground">Turn on cluster observability</p>
              <p class="text-xs text-muted-foreground">
                Kubernetes ships only kubelet + cAdvisor metrics by default. Install the three
                complementary sources to unlock autoscaling, dashboards, and alerting.
              </p>
              <ul class="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                <li>
                  <span class="text-foreground">metrics-server</span> enables
                  <code>kubectl top</code> and HPA
                </li>
                <li>
                  <span class="text-foreground">kube-state-metrics</span> enables Grafana K8s dashboards
                  + most alert rules
                </li>
                <li>
                  <span class="text-foreground">node-exporter</span> enables host-level disk/CPU/network
                  alerts
                </li>
              </ul>
              <div class="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  onclick={doPreflight}
                  loading={preflightRunning}
                  loadingLabel="Running preflight"
                >
                  Run pre-flight checks
                </Button>
              </div>
            </div>
          </div>
        </div>
      {/if}

      {#if preflight}
        <div class="rounded-lg border border-border p-3 space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold">Pre-flight checks</p>
            <Badge
              class="text-white {preflight.overall === 'ok'
                ? 'bg-emerald-500'
                : preflight.overall === 'warn'
                  ? 'bg-amber-500'
                  : preflight.overall === 'fail'
                    ? 'bg-rose-500'
                    : 'bg-slate-500'}">{preflight.overall}</Badge
            >
          </div>
          <ul class="space-y-1.5">
            {#each preflight.checks as check (check.id)}
              <li class="flex items-start gap-2 text-xs">
                {#if check.status === "ok"}
                  <CircleCheck class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {:else if check.status === "warn"}
                  <CircleAlert class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {:else if check.status === "fail"}
                  <CircleX class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {:else}
                  <CircleHelp class="h-4 w-4 {preflightIconColor(check.status)} shrink-0 mt-0.5" />
                {/if}
                <div class="space-y-0.5">
                  <p class="font-medium text-foreground">{check.title}</p>
                  <p class="text-muted-foreground">{check.detail}</p>
                </div>
              </li>
            {/each}
          </ul>
          <p class="text-[10px] text-muted-foreground">
            Ran {new Date(preflight.ranAt).toLocaleString()}
          </p>
        </div>
      {/if}

      <!-- Impact warnings (what is currently broken) -->
      {#if missingCount > 0 || unreachableCount > 0}
        <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
          <p class="text-sm font-semibold text-amber-300">What is currently broken</p>
          <ul class="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
            {#each checks.filter((c) => c.status !== "available") as c (c.id)}
              {@const dep = getDependentsFor(c.id)}
              {#if dep}
                <li>
                  <span class="text-foreground">{dep.sourceTitle} ({c.status})</span>:
                  <span class="text-muted-foreground">
                    {dep.dependents
                      .slice(0, 2)
                      .map((d) => d.title)
                      .join(", ")}{dep.dependents.length > 2
                      ? ` +${dep.dependents.length - 2} more`
                      : ""}
                  </span>
                </li>
              {/if}
            {/each}
          </ul>
        </div>
      {/if}

      <div class="grid gap-4 md:grid-cols-2">
        <div class="rounded-lg border border-border p-3">
          <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Clock4 class="h-4 w-4" /> Last check
          </div>
          <p class="text-sm font-medium text-foreground">
            {formatDate(summary?.lastRunAt ?? null)}
          </p>
          <p class="text-xs text-muted-foreground">
            Cache TTL: {Math.round(config.cacheTtlMs / 1000)}s - Polling every
            {Math.round(config.scheduleMs / 1000)}s
          </p>
        </div>
        <div class="rounded-lg border border-border p-3">
          <p class="text-xs text-muted-foreground mb-1">Summary</p>
          <p class="text-sm font-semibold text-foreground">{summary?.message ?? "-"}</p>
          <p class="text-xs text-muted-foreground">
            {checks.length} sources - Available {availableCount} - Unreachable {unreachableCount} - Not
            found {missingCount}
          </p>
        </div>
      </div>

      <CommandConsole session={installSession} label={installLabel} />

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
                {@const humanized = firstHumanized(check)}
                <Table.TableRow class={check.status === "available" ? "" : "bg-amber-500/5"}>
                  <Table.TableCell>
                    <p class="text-sm font-medium">{check.title}</p>
                    <p class="text-xs text-muted-foreground">{describeCheck(check)}</p>
                    {#if check.status !== "available" && detectIssueTags(check).length > 0}
                      <div class="mt-1 flex flex-wrap gap-1">
                        {#each detectIssueTags(check) as tag}
                          <Badge variant="outline" class="text-[10px] leading-4">{tag}</Badge>
                        {/each}
                      </div>
                    {/if}
                    {#if humanized}
                      <p class="mt-1 text-xs font-medium text-amber-300">{humanized.title}</p>
                      {#if humanized.hint}
                        <p class="text-[11px] text-muted-foreground">{humanized.hint}</p>
                      {/if}
                    {/if}
                  </Table.TableCell>
                  <Table.TableCell>
                    <Badge
                      class="text-white {statusStyles[check.status]} inline-flex items-center gap-1"
                    >
                      {#if check.status === "available"}
                        <CircleCheck class="h-3 w-3" />
                      {:else if check.status === "unreachable"}
                        <CircleAlert class="h-3 w-3" />
                      {:else}
                        <CircleX class="h-3 w-3" />
                      {/if}
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
                    <div class="flex flex-col gap-1">
                      {#if isHelmInstallable(check) && isMissing(check)}
                        <Button
                          size="sm"
                          onclick={() => installSource(check)}
                          loading={installAction[check.id]?.status === "working"}
                          loadingLabel="Installing"
                        >
                          <span>Install (Helm)</span>
                        </Button>
                        {#if installAction[check.id]?.status === "error"}
                          <span class="text-xs text-rose-600"
                            >{installAction[check.id]?.message}</span
                          >
                        {/if}
                      {/if}
                      {#if cliTestCommand[check.id]}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-6 text-[10px]"
                          onclick={() =>
                            copyText(cliTestCommand[check.id], `${check.title} test command`)}
                          title="Copy kubectl commands to test this source"
                        >
                          <Copy class="mr-1 h-3 w-3" /> Test
                        </Button>
                      {/if}
                      {#if humanized?.fixCommand}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-6 text-[10px]"
                          onclick={() => copyText(humanized.fixCommand!, "fix command")}
                          title="Copy suggested fix command"
                        >
                          <Copy class="mr-1 h-3 w-3" /> Fix
                        </Button>
                      {/if}
                    </div>
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
    {/if}

    {#if activeTab === "dependents"}
      <div class="space-y-4">
        <p class="text-xs text-muted-foreground">
          What depends on each metrics source. Use this to understand impact when a source is
          unreachable, and to choose which to install first.
        </p>
        {#each SOURCE_DEPENDENTS as dep (dep.sourceId)}
          {@const currentCheck = checks.find((c) => c.id === dep.sourceId)}
          <div class="rounded-lg border border-border p-3 space-y-2">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="text-sm font-semibold">{dep.sourceTitle}</p>
              {#if currentCheck}
                <Badge
                  class="text-white {statusStyles[
                    currentCheck.status
                  ]} inline-flex items-center gap-1"
                >
                  {#if currentCheck.status === "available"}
                    <CircleCheck class="h-3 w-3" />
                  {:else if currentCheck.status === "unreachable"}
                    <CircleAlert class="h-3 w-3" />
                  {:else}
                    <CircleX class="h-3 w-3" />
                  {/if}
                  {currentCheck.status}
                </Badge>
              {/if}
            </div>
            <p class="text-xs text-muted-foreground">{dep.summary}</p>
            <ul class="space-y-1.5 pl-2">
              {#each dep.dependents as d}
                <li class="text-xs">
                  <p class="text-foreground font-medium">{d.title}</p>
                  <p class="text-muted-foreground">{d.description}</p>
                  {#if d.testCommand}
                    <div class="mt-1 flex items-center gap-1">
                      <pre
                        class="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono overflow-x-auto">{d.testCommand}</pre>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-5 w-5 p-0"
                        onclick={() => copyText(d.testCommand!, "test command")}
                        title="Copy test command"
                      >
                        <Copy class="h-3 w-3" />
                      </Button>
                    </div>
                  {/if}
                  {#if d.alertNames && d.alertNames.length > 0}
                    <p class="text-[10px] text-muted-foreground mt-0.5">
                      Affected alert rules:
                      {#each d.alertNames as an, i}
                        <span class="font-mono text-amber-300"
                          >{an}{i < d.alertNames.length - 1 ? ", " : ""}</span
                        >
                      {/each}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}

    {#if activeTab === "troubleshooting"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          Common issues grouped by category with copyable fix commands. Run pre-flight first on the
          Overview tab to narrow which category applies.
        </p>

        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold text-foreground">TLS / IP SANs (kubelet cert)</p>
          <p class="text-xs text-muted-foreground">
            Typical on minikube / kind / k3s / bare-metal. metrics-server cannot validate the
            kubelet certificate because it lacks an IP SAN for the node IP. Symptoms:
            <code
              >x509: cannot validate certificate for X.X.X.X because it doesn't contain any IP SANs</code
            >
          </p>
          <div class="flex items-start gap-1">
            <pre
              class="rounded bg-muted/30 px-1.5 py-1 text-[10px] font-mono overflow-x-auto flex-1">{`helm upgrade --install metrics-server metrics-server/metrics-server \\
  --namespace kube-system \\
  --set args='{--kubelet-insecure-tls}'`}</pre>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 w-6 p-0"
              onclick={() =>
                copyText(
                  `helm upgrade --install metrics-server metrics-server/metrics-server --namespace kube-system --set args='{--kubelet-insecure-tls}'`,
                  "fix command",
                )}
              title="Copy"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold text-foreground">
            RBAC denied (ServiceAccount / ClusterRole)
          </p>
          <p class="text-xs text-muted-foreground">
            The operator's ServiceAccount is missing its ClusterRoleBinding, or your kubeconfig user
            lacks rights on the metrics endpoint.
          </p>
          <div class="flex items-start gap-1">
            <pre
              class="rounded bg-muted/30 px-1.5 py-1 text-[10px] font-mono overflow-x-auto flex-1">{`kubectl get clusterrolebinding | grep -E 'metrics-server|kube-state-metrics|node-exporter'
kubectl auth can-i get nodes/metrics`}</pre>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 w-6 p-0"
              onclick={() =>
                copyText(
                  `kubectl get clusterrolebinding | grep -E 'metrics-server|kube-state-metrics|node-exporter'\nkubectl auth can-i get nodes/metrics`,
                  "RBAC check",
                )}
              title="Copy"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold text-foreground">node-exporter DaemonSet coverage</p>
          <p class="text-xs text-muted-foreground">
            Helm chart ships default tolerations only for common taints. Control-plane / GPU / ARM /
            spot nodes may be excluded.
          </p>
          <div class="flex items-start gap-1">
            <pre
              class="rounded bg-muted/30 px-1.5 py-1 text-[10px] font-mono overflow-x-auto flex-1">{`kubectl get nodes -o wide
kubectl get ds -A -l app.kubernetes.io/name=node-exporter
# Check which nodes have a pod:
kubectl get pods -A -l app.kubernetes.io/name=node-exporter -o wide`}</pre>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 w-6 p-0"
              onclick={() =>
                copyText(
                  `kubectl get nodes -o wide\nkubectl get ds -A -l app.kubernetes.io/name=node-exporter\nkubectl get pods -A -l app.kubernetes.io/name=node-exporter -o wide`,
                  "coverage check",
                )}
              title="Copy"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold text-foreground">
            PodSecurity Admission blocking privileged pods
          </p>
          <p class="text-xs text-muted-foreground">
            node-exporter uses hostNetwork and hostPID. Namespaces with
            <code>pod-security.kubernetes.io/enforce=restricted</code> will reject its pods.
          </p>
          <div class="flex items-start gap-1">
            <pre
              class="rounded bg-muted/30 px-1.5 py-1 text-[10px] font-mono overflow-x-auto flex-1">{`kubectl label namespace monitoring \\
  pod-security.kubernetes.io/enforce=privileged --overwrite`}</pre>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 w-6 p-0"
              onclick={() =>
                copyText(
                  `kubectl label namespace monitoring pod-security.kubernetes.io/enforce=privileged --overwrite`,
                  "PSA override",
                )}
              title="Copy"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div class="rounded-lg border border-border p-3 space-y-2">
          <p class="text-sm font-semibold text-foreground">Test each source with kubectl</p>
          <div class="flex items-start gap-1">
            <pre
              class="rounded bg-muted/30 px-1.5 py-1 text-[10px] font-mono overflow-x-auto flex-1">{`# metrics-server
kubectl top nodes
kubectl top pods -A

# kube-state-metrics
kubectl port-forward -n monitoring svc/kube-state-metrics 8080:8080
curl -s http://localhost:8080/metrics | grep kube_deployment_status_replicas | head -5

# node-exporter
kubectl get ds -A -l app.kubernetes.io/name=node-exporter
kubectl exec -n monitoring node-exporter-xxxxx -- wget -qO- localhost:9100/metrics | head -20

# kubelet / cAdvisor
kubectl get --raw /api/v1/nodes/NODE_NAME/proxy/metrics/cadvisor | head -20`}</pre>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 w-6 p-0"
              onclick={() =>
                copyText(
                  `# metrics-server\nkubectl top nodes\nkubectl top pods -A\n\n# kube-state-metrics\nkubectl port-forward -n monitoring svc/kube-state-metrics 8080:8080\ncurl -s http://localhost:8080/metrics | grep kube_deployment_status_replicas | head -5\n\n# node-exporter\nkubectl get ds -A -l app.kubernetes.io/name=node-exporter\nkubectl exec -n monitoring node-exporter-xxxxx -- wget -qO- localhost:9100/metrics | head -20\n\n# kubelet / cAdvisor\nkubectl get --raw /api/v1/nodes/NODE_NAME/proxy/metrics/cadvisor | head -20`,
                  "all test commands",
                )}
              title="Copy"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
