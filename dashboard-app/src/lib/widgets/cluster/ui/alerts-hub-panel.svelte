<script lang="ts">
  import { onMount } from "svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    alertHubConfig,
    alertHubState,
    createSilence,
    markAlertHubUnavailable,
    runAlertHubScan,
    startAlertHubPolling,
    stopAlertHubPolling,
  } from "$features/alerts-hub";
  import type { AlertItem, AlertSeverity, AlertSource, AlertState } from "$features/alerts-hub";
  import {
    getPrometheusStackRelease,
    installPrometheusStack,
    type HelmListedRelease,
  } from "$shared/api/helm";
  import { kubectlRawFront } from "$shared/api/kubectl-proxy";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import { Input } from "$shared/ui/input";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import * as Table from "$shared/ui/table";
  import * as Alert from "$shared/ui/alert";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  const hubState = $derived($alertHubState[clusterId]);
  const summary = $derived(hubState?.summary ?? null);
  const config = $derived($alertHubConfig);

  let stateFilter = $state<AlertState | "all">("all");
  let severityFilter = $state<AlertSeverity | "all">("all");
  let sourceFilter = $state<AlertSource | "all">("all");
  let timeFilter = $state<"1h" | "6h" | "24h" | "all">("6h");
  let groupBy = $state<"none" | "alertname" | "namespace" | "receiver">("alertname");
  let searchValue = $state("");
  let debouncedSearch = $state("");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let monitoringLoading = $state(false);
  let monitoringInstalling = $state(false);
  let refreshing = $state(false);
  let refreshError = $state<string | null>(null);
  let monitoringRelease = $state<HelmListedRelease | null>(null);
  let monitoringError = $state<string | null>(null);
  let monitoringMessage = $state<string | null>(null);
  let monitoringNamespaceDraft = $state("monitoring");
  let pageVisible = $state(true);
  let refreshRequestId = 0;
  let monitoringRequestId = 0;
  let monitoringInstallRequestId = 0;
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const stateIcons: Record<AlertState, string> = {
    firing: "🔥",
    pending: "⏳",
    silenced: "😶",
    inhibited: "🚫",
  };

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    unavailable: "bg-slate-500",
  };

  const severityStyles: Record<AlertSeverity, string> = {
    page: "bg-rose-600",
    warn: "bg-amber-500",
    info: "bg-slate-500",
    unknown: "bg-slate-400",
  };

  function formatDate(value: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function matchesTimeFilter(alert: AlertItem) {
    if (timeFilter === "all") return true;
    const hours = Number.parseInt(timeFilter.replace("h", ""), 10);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return new Date(alert.since).getTime() >= cutoff;
  }

  function matchesSearch(alert: AlertItem) {
    if (!debouncedSearch.trim()) return true;
    const text = `${alert.alertname} ${alert.summary ?? ""} ${alert.description ?? ""} ${Object.values(alert.labels).join(" ")}`.toLowerCase();
    return text.includes(debouncedSearch.trim().toLowerCase());
  }

  const filteredAlerts = $derived.by(() => {
    const alerts = hubState?.alerts ?? [];
    return alerts.filter((alert) => {
      const stateOk = stateFilter === "all" || alert.state === stateFilter;
      const severityOk = severityFilter === "all" || alert.severity === severityFilter;
      const sourceOk = sourceFilter === "all" || alert.source === sourceFilter;
      return stateOk && severityOk && sourceOk && matchesTimeFilter(alert) && matchesSearch(alert);
    });
  });

  const groupedAlerts = $derived.by(() => {
    if (groupBy === "none") {
      return [{ key: "All alerts", items: filteredAlerts }];
    }

    const groups = new Map<string, AlertItem[]>();
    for (const alert of filteredAlerts) {
      const key =
        groupBy === "alertname"
          ? alert.alertname
          : groupBy === "namespace"
            ? alert.namespace ?? "(none)"
            : alert.receiver ?? "(none)";
      const items = groups.get(key) ?? [];
      items.push(alert);
      groups.set(key, items);
    }

    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  });

  async function runNow() {
    if (!clusterId || refreshing) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    refreshing = true;
    refreshError = null;
    try {
      await runAlertHubScan(activeClusterId, { force: true });
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
    } catch (error) {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshError = error instanceof Error ? error.message : "Failed to refresh alert status";
    } finally {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshing = false;
    }
  }

  function chartVersion(chart: string | undefined): string {
    if (!chart) return "unknown";
    const match = chart.match(/-(\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?)$/);
    return match?.[1] ?? "unknown";
  }

  function podIsReady(pod: {
    status?: {
      phase?: string;
      conditions?: Array<{ type?: string; status?: string }>;
      containerStatuses?: Array<{ ready?: boolean }>;
    };
  }) {
    const phase = (pod.status?.phase || "").toLowerCase();
    if (phase !== "running") return false;
    const readyCondition =
      pod.status?.conditions?.some((condition) => condition.type === "Ready" && condition.status === "True") ??
      false;
    const allContainersReady =
      (pod.status?.containerStatuses?.length ?? 0) > 0 &&
      (pod.status?.containerStatuses?.every((container) => container.ready === true) ?? false);
    return readyCondition || allContainersReady;
  }

  async function checkPrometheusStackReadiness(
    clusterId: string,
    namespace: string,
  ): Promise<{ ready: boolean; error?: string }> {
    const podsRaw = await kubectlRawFront(`get pod -n ${namespace} -o json`, { clusterId });
    if (podsRaw.errors.length || podsRaw.code !== 0) {
      return { ready: false, error: podsRaw.errors || "Failed to query monitoring pods" };
    }

    try {
      const parsed = JSON.parse(podsRaw.output) as {
        items?: Array<{
          metadata?: { name?: string; labels?: Record<string, string> };
          status?: {
            phase?: string;
            conditions?: Array<{ type?: string; status?: string }>;
            containerStatuses?: Array<{ ready?: boolean }>;
          };
        }>;
      };
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const alertmanagerPods = items.filter((pod) => {
        const name = (pod.metadata?.name || "").toLowerCase();
        const appName = (pod.metadata?.labels?.["app.kubernetes.io/name"] || "").toLowerCase();
        return name.includes("alertmanager") || appName.includes("alertmanager");
      });
      const prometheusPods = items.filter((pod) => {
        const name = (pod.metadata?.name || "").toLowerCase();
        const appName = (pod.metadata?.labels?.["app.kubernetes.io/name"] || "").toLowerCase();
        if (name.includes("alertmanager") || appName.includes("alertmanager")) return false;
        if (name.includes("operator") || appName.includes("operator")) return false;
        if (name.includes("node-exporter") || appName.includes("node-exporter")) return false;
        if (name.includes("kube-state-metrics") || appName.includes("kube-state-metrics")) return false;
        return name.includes("prometheus") || appName.includes("prometheus");
      });

      const alertReady = alertmanagerPods.some((pod) => podIsReady(pod));
      const prometheusReady = prometheusPods.some((pod) => podIsReady(pod));

      if (!alertReady || !prometheusReady) {
        return {
          ready: false,
          error: `Monitoring stack installed but not ready (prometheus ready: ${prometheusReady ? "yes" : "no"}, alertmanager ready: ${alertReady ? "yes" : "no"})`,
        };
      }
      return { ready: true };
    } catch (error) {
      return {
        ready: false,
        error: error instanceof Error ? error.message : "Failed to parse monitoring pod state",
      };
    }
  }

  async function refreshMonitoringStatus() {
    if (!clusterId) return;
    const requestId = ++monitoringRequestId;
    const activeClusterId = clusterId;
    monitoringLoading = true;
    monitoringError = null;
    try {
      const release = await getPrometheusStackRelease(activeClusterId);
      if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
      if (release.error) {
        monitoringRelease = null;
        monitoringError = release.error;
        return;
      }
      monitoringRelease = release.release ?? null;
      if (monitoringRelease?.namespace) {
        monitoringNamespaceDraft = monitoringRelease.namespace;
        const readiness = await checkPrometheusStackReadiness(
          activeClusterId,
          monitoringRelease.namespace,
        );
        if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
        if (!readiness.ready) {
          monitoringError = readiness.error ?? "Monitoring stack is not Ready";
        }
      }
    } catch (error) {
      if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
      monitoringRelease = null;
      monitoringError =
        error instanceof Error ? error.message : "Failed to check monitoring Helm release";
    } finally {
      if (requestId !== monitoringRequestId || activeClusterId !== clusterId) return;
      monitoringLoading = false;
    }
  }

  async function installMonitoringStack() {
    if (!clusterId || monitoringInstalling || monitoringLoading) return;
    const requestId = ++monitoringInstallRequestId;
    const activeClusterId = clusterId;
    monitoringInstalling = true;
    monitoringError = null;
    monitoringMessage = null;
    try {
      const namespace = monitoringNamespaceDraft.trim() || "monitoring";
      const result = await installPrometheusStack(activeClusterId, namespace);
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      if (!result.success) {
        throw new Error(result.error ?? "Failed to install Prometheus stack");
      }
      await refreshMonitoringStatus();
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      await runAlertHubScan(activeClusterId, { force: true });
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      monitoringMessage = `Monitoring stack is installed in namespace ${namespace}.`;
    } catch (error) {
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      monitoringError = error instanceof Error ? error.message : "Failed to install monitoring stack";
    } finally {
      if (requestId !== monitoringInstallRequestId || activeClusterId !== clusterId) return;
      monitoringInstalling = false;
    }
  }

  function handleCreateSilence(alert: AlertItem) {
    if (alert.source !== "alertmanager") return;

    createSilence(clusterId, {
      alertname: alert.alertname,
      namespace: alert.namespace,
      durationHours: 4,
      author: "operator@rozoom",
      comment: "Temporary silence from dashboard",
    });
  }

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
    clusterId;
    refreshRequestId += 1;
    monitoringRequestId += 1;
    monitoringInstallRequestId += 1;
  });

  $effect(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debouncedSearch = searchValue;
    }, 500);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  $effect(() => {
    if (!clusterId) return;

    if (offline) {
      stopAlertHubPolling(clusterId);
      markAlertHubUnavailable(clusterId, "Alert feed unavailable: cluster is offline");
      return;
    }

    if (!autoDiagnosticsEnabled) {
      stopAlertHubPolling(clusterId);
      return;
    }

    if (!pageVisible) {
      stopAlertHubPolling(clusterId);
      return;
    }

    startAlertHubPolling(clusterId);
    void refreshMonitoringStatus();

    return () => {
      stopAlertHubPolling(clusterId);
    };
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Unified alerts feed from Alertmanager, Prometheus, and Kubernetes warning events."
        >
          Cluster Alerts
        </h2>
        {#if summary}
          <Badge class="text-white {statusStyles[summary.status]}">
            {summary.status}
          </Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Cluster alerts info"
              title="About alerts sources"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[420px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Alerts sources</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">Prometheus:</span>
                evaluates alerting rules and generates alerts from cluster metrics.
              </p>
              <p>
                <span class="font-medium text-foreground">Alertmanager:</span>
                handles grouping, routing, deduplication, and silencing of alerts.
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/prometheus/prometheus"
                target="_blank"
                rel="noreferrer noopener"
              >
                Prometheus GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://github.com/prometheus/alertmanager"
                target="_blank"
                rel="noreferrer noopener"
              >
                Alertmanager GitHub
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <Button variant="outline" onclick={runNow} loading={refreshing} loadingLabel="Refreshing">
        <Refresh class="mr-2 h-4 w-4" /> Refresh status
      </Button>
    </div>
    <p class="text-sm text-muted-foreground">
      Unified alert feed from Alertmanager, Prometheus, and Kubernetes warning events.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
    <div class="rounded-lg border border-border/60 bg-background/40 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs text-muted-foreground">Prometheus + Alertmanager via Helm (cross-namespace check)</p>
          {#if monitoringLoading}
            <p class="text-sm text-muted-foreground inline-flex items-center gap-1">
              <span>Checking</span>
              <LoadingDots />
            </p>
          {:else if monitoringRelease}
            <p class="text-sm text-foreground">
              Installed: <span class="font-semibold">{monitoringRelease.name}</span>
              <span class="text-xs text-muted-foreground"> v{chartVersion(monitoringRelease.chart)}</span> in
              <span class="font-semibold">{monitoringRelease.namespace}</span> namespace
            </p>
          {:else}
            <p class="text-sm text-amber-600">Not installed</p>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#if !monitoringRelease}
            <input
              class="h-9 min-w-[180px] rounded-md border border-input bg-background px-3 text-sm"
              bind:value={monitoringNamespaceDraft}
              placeholder="monitoring"
              disabled={monitoringInstalling}
            />
          {/if}
          <Button
            variant="outline"
            onclick={refreshMonitoringStatus}
            loading={monitoringLoading}
            loadingLabel="Refreshing"
            disabled={monitoringInstalling}
          >
            Refresh status
          </Button>
          {#if !monitoringRelease}
            <Button
              onclick={installMonitoringStack}
              loading={monitoringInstalling}
              loadingLabel="Installing"
              disabled={monitoringLoading}
            >
              <span>Install Prometheus + Alertmanager</span>
            </Button>
          {/if}
        </div>
      </div>
      {#if monitoringError}
        <p class="mt-2 text-xs text-rose-600">{monitoringError}</p>
      {/if}
      {#if monitoringMessage}
        <p class="mt-2 text-xs text-emerald-600">{monitoringMessage}</p>
      {/if}
    </div>

    {#if summary?.status === "unavailable"}
      <Alert.Root variant="destructive">
        <Alert.Title>Alert feed unavailable</Alert.Title>
        <Alert.Description>{summary.message}</Alert.Description>
      </Alert.Root>
    {:else if summary?.status === "degraded"}
      <Alert.Root variant="default">
        <Alert.Title>Degraded alert feed</Alert.Title>
        <Alert.Description>Fallback to Kubernetes events only.</Alert.Description>
      </Alert.Root>
    {/if}
    {#if refreshError}
      <Alert.Root variant="destructive">
        <Alert.Title>Refresh failed</Alert.Title>
        <Alert.Description>{refreshError}</Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-3 lg:grid-cols-5">
      <div class="lg:col-span-2">
        <Input placeholder="Search alerts" bind:value={searchValue} />
      </div>
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={stateFilter}
      >
        <option value="all">All states</option>
        <option value="firing">Firing</option>
        <option value="pending">Pending</option>
        <option value="silenced">Silenced</option>
        <option value="inhibited">Inhibited</option>
      </select>
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={severityFilter}
      >
        <option value="all">All severities</option>
        <option value="page">Page</option>
        <option value="warn">Warn</option>
        <option value="info">Info</option>
        <option value="unknown">Unknown</option>
      </select>
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={sourceFilter}
      >
        <option value="all">All sources</option>
        <option value="alertmanager">Alertmanager</option>
        <option value="prometheus">Prometheus</option>
        <option value="events">Events</option>
      </select>
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={timeFilter}
      >
        <option value="1h">Last 1h</option>
        <option value="6h">Last 6h</option>
        <option value="24h">Last 24h</option>
        <option value="all">All time</option>
      </select>
      <select
        class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        bind:value={groupBy}
      >
        <option value="none">No grouping</option>
        <option value="alertname">Group by alertname</option>
        <option value="namespace">Group by namespace</option>
        <option value="receiver">Group by receiver</option>
      </select>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last refresh">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock4 class="h-4 w-4" /> Last refresh
        </div>
        <p class="text-sm font-medium text-foreground">{formatDate(summary?.lastRunAt ?? null)}</p>
        <p class="text-xs text-muted-foreground">
          Source: {summary?.source ?? "none"} · Polling every {Math.round(config.scheduleMs / 1000)}s
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          Alertmanager last success: {formatDate(summary?.alertmanagerLastSuccessAt ?? null)}
        </p>
        {#if summary?.alertmanagerLastError}
          <p class="mt-1 text-xs text-amber-600">
            Alertmanager last error: {summary.alertmanagerLastError}
          </p>
        {/if}
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Loaded alerts">
        <p class="text-2xl font-semibold text-foreground">{filteredAlerts.length}</p>
        <p class="text-xs text-muted-foreground">{summary?.message ?? "-"}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="space-y-4">
      {#if groupedAlerts.length === 0}
        <div class="rounded-lg border border-border/60 bg-background/40 p-2">
          <TableEmptyState message="No results for the current filter." />
        </div>
      {:else}
        {#each groupedAlerts as group}
          <div class="rounded-lg border border-border/60 bg-background/40">
            <div class="flex items-center justify-between border-b border-border px-4 py-2">
              <p class="text-sm font-semibold text-foreground">{group.key}</p>
              <Badge class="bg-secondary text-secondary-foreground">{group.items.length}</Badge>
            </div>
            <TableSurface maxHeightClass="">
              <Table.Table>
              <Table.TableHeader>
                <Table.TableRow>
                  <Table.TableHead>State</Table.TableHead>
                  <Table.TableHead>Severity</Table.TableHead>
                  <Table.TableHead>Alertname</Table.TableHead>
                  <Table.TableHead>Since</Table.TableHead>
                  <Table.TableHead>Namespace/Pod/Node</Table.TableHead>
                  <Table.TableHead>Receiver</Table.TableHead>
                  <Table.TableHead>Summary</Table.TableHead>
                  <Table.TableHead>Actions</Table.TableHead>
                </Table.TableRow>
              </Table.TableHeader>
              <Table.TableBody>
                {#each group.items as alert}
                  <Table.TableRow>
                    <Table.TableCell>
                      <span class="mr-2">{stateIcons[alert.state]}</span>
                      {alert.state}
                    </Table.TableCell>
                    <Table.TableCell>
                      <Badge class="text-white {severityStyles[alert.severity]}">
                        {alert.severity}
                      </Badge>
                    </Table.TableCell>
                    <Table.TableCell>{alert.alertname}</Table.TableCell>
                    <Table.TableCell>{formatDate(alert.since)}</Table.TableCell>
                    <Table.TableCell>
                      <div class="text-xs text-muted-foreground">
                        {alert.namespace ?? "-"}
                      </div>
                      <div class="text-xs text-muted-foreground">
                        {alert.pod ?? alert.node ?? "-"}
                      </div>
                    </Table.TableCell>
                    <Table.TableCell>{alert.receiver ?? "-"}</Table.TableCell>
                    <Table.TableCell>
                      <p class="text-sm font-medium text-foreground">{alert.summary ?? "-"}</p>
                      <p class="line-clamp-2 text-xs text-muted-foreground">{alert.description ?? ""}</p>
                      {#if alert.runbookUrl}
                        <a
                          class="text-xs text-primary hover:text-primary/80"
                          href={alert.runbookUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open runbook
                        </a>
                      {/if}
                    </Table.TableCell>
                    <Table.TableCell>
                      <div class="flex flex-col gap-1 text-xs">
                        {#if alert.state === "silenced" && alert.silenceEndsAt}
                          <span class="text-muted-foreground">
                            Silence ends {formatDate(alert.silenceEndsAt)}
                          </span>
                        {/if}
                        {#if alert.source === "alertmanager"}
                          <Button size="sm" variant="outline" onclick={() => handleCreateSilence(alert)}>
                            Create silence
                          </Button>
                        {/if}
                      </div>
                    </Table.TableCell>
                  </Table.TableRow>
                {/each}
              </Table.TableBody>
              </Table.Table>
            </TableSurface>
          </div>
        {/each}
      {/if}
    </div>
  </Card.Content>
</Card.Root>
