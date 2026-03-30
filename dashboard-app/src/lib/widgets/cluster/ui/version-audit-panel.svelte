<script lang="ts">
  import { onMount } from "svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    markVersionAuditUnavailable,
    runVersionAudit,
    startVersionAuditPolling,
    stopVersionAuditPolling,
    versionAuditConfig,
    versionAuditState,
  } from "$features/version-audit";
  import type { HelmChartInfo } from "$features/version-audit";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import * as Alert from "$shared/ui/alert";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  const auditState = $derived($versionAuditState[clusterId]);
  const summary = $derived(auditState?.summary ?? null);
  const history = $derived(auditState?.history ?? []);
  const latestRun = $derived(history[0] ?? null);
  const config = $derived($versionAuditConfig);
  const charts = $derived<HelmChartInfo[]>(
    [...(latestRun?.charts ?? [])].sort((a, b) => {
      const rank = (status: HelmChartInfo["status"]) =>
        status === "outdated" ? 0 : status === "unknown" ? 1 : 2;
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus !== 0) return byStatus;
      return a.name.localeCompare(b.name);
    }),
  );
  let refreshing = $state(false);
  let pageVisible = $state(true);
  let refreshRequestId = 0;
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const k8sStatusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    outdated: "bg-amber-500",
    unsupported: "bg-rose-600",
    unreachable: "bg-slate-500",
  };

  const chartStatusStyles: Record<string, string> = {
    "up-to-date": "bg-emerald-500",
    outdated: "bg-amber-500",
    unknown: "bg-slate-500",
  };

  const chartStatusLabels: Record<string, string> = {
    "up-to-date": "Up to date",
    outdated: "Outdated",
    unknown: "Unknown",
  };

  function formatDate(value: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function formatDuration(ms: number) {
    const minutes = Math.round(ms / 60000);
    return `${minutes}m`;
  }

  async function runNow() {
    if (refreshing) return;
    const requestId = ++refreshRequestId;
    const activeClusterId = clusterId;
    refreshing = true;
    try {
      await runVersionAudit(activeClusterId, { force: true, source: "manual" });
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
    } finally {
      if (requestId !== refreshRequestId || activeClusterId !== clusterId) return;
      refreshing = false;
    }
  }

  $effect(() => {
    clusterId;
    refreshRequestId += 1;
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
      stopVersionAuditPolling(clusterId);
      markVersionAuditUnavailable(clusterId, "Version audit unavailable: cluster is offline");
      return;
    }

    if (!autoDiagnosticsEnabled) {
      stopVersionAuditPolling(clusterId);
      return;
    }

    if (!pageVisible) {
      stopVersionAuditPolling(clusterId);
      return;
    }

    startVersionAuditPolling(clusterId);

    return () => {
      stopVersionAuditPolling(clusterId);
    };
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Check Kubernetes server version policy and Helm chart update status."
        >
          Cluster Version & Helm Audit
        </h2>
        {#if summary}
          <Badge class="text-white {k8sStatusStyles[summary.k8sStatus]}">
            {summary.k8sStatus}
          </Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Version audit info"
              title="About version and Helm audit"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[420px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Version & Helm audit sources</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">Kubernetes version policy:</span>
                checks server version against supported release windows.
              </p>
              <p>
                <span class="font-medium text-foreground">Helm audit:</span>
                compares installed chart versions with available chart updates.
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/kubernetes/kubernetes"
                target="_blank"
                rel="noreferrer noopener"
              >
                Kubernetes GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://github.com/helm/helm"
                target="_blank"
                rel="noreferrer noopener"
              >
                Helm GitHub
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <Button variant="outline" onclick={runNow} loading={refreshing} loadingLabel="Refreshing">
        <Refresh class="mr-2 h-4 w-4" />
        <span>Refresh status</span>
      </Button>
    </div>
    <p class="text-sm text-muted-foreground">
      Compare Kubernetes versions with the support policy and detect outdated Helm charts.
    </p>
  </Card.Header>
  <Card.Content class="space-y-6">
    {#if summary?.k8sStatus === "unreachable"}
      <Alert.Root variant="destructive">
        <Alert.Title>Cluster unreachable</Alert.Title>
        <Alert.Description>{summary?.message ?? "Unable to fetch /version."}</Alert.Description>
      </Alert.Root>
    {/if}

    {#if summary?.errors?.length}
      <Alert.Root variant="destructive">
        <Alert.Title>Audit errors</Alert.Title>
        <Alert.Description>
          <ul class="list-disc pl-4 text-xs">
            {#each summary.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DiagnosticSummaryCard title="Server version">
        <p class="text-2xl font-semibold text-foreground">{summary?.k8sVersion ?? "-"}</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Minimum supported">
        <p class="text-sm font-semibold text-foreground">{summary?.minSupported ?? "-"}</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Outdated charts">
        <p class="text-2xl font-semibold text-foreground">{summary?.outdatedCharts ?? 0}</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Total charts">
        <p class="text-2xl font-semibold text-foreground">{summary?.totalCharts ?? 0}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last audit">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock4 class="h-4 w-4" /> Last audit
        </div>
        <p class="text-sm font-medium text-foreground">{formatDate(summary?.lastRunAt ?? null)}</p>
        <p class="text-xs text-muted-foreground">
          Cached for {formatDuration(config.cacheTtlMs)} · Auto-run every
          {formatDuration(config.scheduleMs)}
        </p>
        <p class="text-xs text-muted-foreground">
          Cache expires: {formatDate(summary?.cacheExpiresAt ?? null)}
        </p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Status">
        <p class="text-sm font-semibold text-foreground">{summary?.message ?? "Audit unavailable"}</p>
        <p class="text-xs text-muted-foreground">
          Charts status: {summary?.chartStatus ?? "unknown"}
        </p>
      </DiagnosticSummaryCard>
    </div>

    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-foreground">Installed Helm charts</h3>
        <Badge class="text-white {k8sStatusStyles[summary?.k8sStatus ?? "unreachable"]}">
          {summary?.k8sStatus ?? "unreachable"}
        </Badge>
      </div>
      <TableSurface maxHeightClass="">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Name</Table.TableHead>
              <Table.TableHead>Namespace</Table.TableHead>
              <Table.TableHead>Installed</Table.TableHead>
              <Table.TableHead>Latest</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
              <Table.TableHead>Actions</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if charts.length === 0}
              <Table.TableRow>
                <Table.TableCell colspan={6} class="text-center">
                  <TableEmptyState message="No results for the current filter." />
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each charts as chart}
                <Table.TableRow>
                  <Table.TableCell>{chart.name}</Table.TableCell>
                  <Table.TableCell>{chart.namespace}</Table.TableCell>
                  <Table.TableCell>{chart.version}</Table.TableCell>
                  <Table.TableCell>{chart.latest ?? "-"}</Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {chartStatusStyles[chart.status]}">
                      {chartStatusLabels[chart.status]}
                    </Badge>
                  </Table.TableCell>
                  <Table.TableCell>
                    <div class="flex flex-wrap gap-2">
                      {#if chart.repoUrl}
                        <a
                          class="text-xs text-primary hover:text-primary/80"
                          href={chart.repoUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Go to repo
                        </a>
                      {/if}
                    </div>
                    {#if chart.error}
                      <p class="mt-1 text-xs text-amber-600">{chart.error}</p>
                    {/if}
                  </Table.TableCell>
                </Table.TableRow>
              {/each}
            {/if}
          </Table.TableBody>
        </Table.Table>
      </TableSurface>
    </div>
  </Card.Content>
</Card.Root>
