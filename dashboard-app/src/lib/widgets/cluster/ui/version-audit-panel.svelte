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
  import type { HelmChartInfo, VersionAuditRun } from "$features/version-audit";
  import { installOrUpgradeHelmRelease } from "$shared/api/helm";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { toast } from "svelte-sonner";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Clock4, Info, Refresh } from "$shared/ui/icons";
  import * as Alert from "$shared/ui/alert";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";
  import { CommandConsole, createConsoleSession } from "$shared/ui/command-console";

  type Severity = "major" | "minor" | "patch" | "unknown";

  function stripV(v: string): string {
    return v.replace(/^v/, "");
  }

  function semverParts(v: string): [number, number, number] | null {
    const m = stripV(v).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function severity(installed: string, latest: string | null): Severity {
    if (!latest) return "unknown";
    const a = semverParts(installed);
    const b = semverParts(latest);
    if (!a || !b) return "unknown";
    if (b[0] > a[0]) return "major";
    if (b[1] > a[1]) return "minor";
    if (b[2] > a[2]) return "patch";
    return "unknown";
  }

  const severityStyles: Record<Severity, string> = {
    major: "bg-rose-600",
    minor: "bg-amber-500",
    patch: "bg-sky-600",
    unknown: "bg-slate-500",
  };

  const severityLabels: Record<Severity, string> = {
    major: "Major",
    minor: "Minor",
    patch: "Patch",
    unknown: "Unknown",
  };

  function artifactHubUrl(chart: HelmChartInfo): string | null {
    if (!chart.repoName || !chart.chartName) return null;
    return `https://artifacthub.io/packages/helm/${encodeURIComponent(chart.repoName)}/${encodeURIComponent(chart.chartName)}`;
  }

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  const auditState = $derived($versionAuditState[clusterId]);
  const summary = $derived(auditState?.summary ?? null);
  const history = $derived(auditState?.history ?? []);
  const latestRun = $derived(history[0] ?? null);
  const previousRun = $derived<VersionAuditRun | null>(history[1] ?? null);
  const config = $derived($versionAuditConfig);
  const charts = $derived<HelmChartInfo[]>(
    [...(latestRun?.charts ?? [])].sort((a, b) => {
      const rank = (status: HelmChartInfo["status"]) =>
        status === "outdated" ? 0 : status === "unknown" ? 1 : 2;
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus !== 0) return byStatus;
      const sa = severity(a.version, a.latest);
      const sb = severity(b.version, b.latest);
      const sevRank: Record<Severity, number> = { major: 0, minor: 1, patch: 2, unknown: 3 };
      const bySev = sevRank[sa] - sevRank[sb];
      if (bySev !== 0) return bySev;
      return a.name.localeCompare(b.name);
    }),
  );

  const chartsWithErrors = $derived(charts.filter((c) => Boolean(c.error)));
  const outdatedCharts = $derived(charts.filter((c) => c.status === "outdated"));
  const patchOnly = $derived(
    outdatedCharts.filter((c) => Boolean(c.chartPath) && severity(c.version, c.latest) === "patch"),
  );

  const previousOutdatedKeys = $derived.by<Set<string>>(() => {
    if (!previousRun) return new Set<string>();
    return new Set(
      previousRun.charts
        .filter((c) => c.status === "outdated")
        .map((c) => `${c.namespace}/${c.name}`),
    );
  });

  function isNewlyOutdated(chart: HelmChartInfo): boolean {
    if (chart.status !== "outdated") return false;
    if (!previousRun) return false;
    return !previousOutdatedKeys.has(`${chart.namespace}/${chart.name}`);
  }

  const cacheFreshness = $derived.by<{
    percent: number;
    isStale: boolean;
    isExpiringSoon: boolean;
  }>(() => {
    if (!summary?.lastRunAt || !summary.cacheExpiresAt || config.cacheTtlMs <= 0) {
      return { percent: 0, isStale: false, isExpiringSoon: false };
    }
    const lastRun = Date.parse(summary.lastRunAt);
    const expiresAt = Date.parse(summary.cacheExpiresAt);
    if (Number.isNaN(lastRun) || Number.isNaN(expiresAt)) {
      return { percent: 0, isStale: false, isExpiringSoon: false };
    }
    const total = Math.max(1, expiresAt - lastRun);
    const used = Math.max(0, Date.now() - lastRun);
    const percent = Math.min(1, used / total);
    return { percent, isStale: percent >= 1, isExpiringSoon: percent >= 0.75 && percent < 1 };
  });

  let refreshing = $state(false);
  let pageVisible = $state(true);
  let refreshRequestId = 0;
  let upgradingKey = $state<string | null>(null);
  // Single shared console: both single-chart upgrade and bulk sequences
  // serialize via upgradingKey/bulkProgress, so one session is safe.
  const upgradeSession = createConsoleSession();
  let upgradeSessionLabel = $state("Helm upgrade");
  let bulkProgress = $state<{
    total: number;
    done: number;
    current: string | null;
    failures: string[];
  } | null>(null);
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  function chartKey(c: HelmChartInfo): string {
    return `${c.namespace}/${c.name}`;
  }

  async function upgradeChart(chart: HelmChartInfo) {
    if (!chart.chartPath) {
      toast.error(`Cannot auto-upgrade ${chart.name}: chart path not resolvable from helm search.`);
      return;
    }
    const sev = severity(chart.version, chart.latest);
    const confirmed = await confirmAction(
      `Upgrade "${chart.name}" in namespace "${chart.namespace}"?\n\n` +
        `Current: ${chart.version}\n` +
        `Target:  ${chart.latest ?? "latest"}\n` +
        `Severity: ${severityLabels[sev]} bump\n\n` +
        `helm upgrade will re-apply the chart; running workloads may restart. ` +
        `Consider running Preview in the Helm page first for big bumps.`,
      `Upgrade ${chart.name}`,
    );
    if (!confirmed) return;
    upgradingKey = chartKey(chart);
    upgradeSessionLabel = `Upgrading ${chart.name} -> ${chart.latest ?? "latest"}`;
    upgradeSession.start();
    try {
      const result = await installOrUpgradeHelmRelease(clusterId, {
        releaseName: chart.name,
        chart: chart.chartPath,
        namespace: chart.namespace,
        createNamespace: false,
        chartVersion: chart.latest ?? undefined,
        onOutput: (chunk) => upgradeSession.append(chunk),
      });
      if (!result.success) {
        toast.error(`Upgrade failed: ${result.error?.slice(0, 200) ?? "unknown"}`);
        upgradeSession.fail();
        return;
      }
      toast.success(`${chart.name} upgraded to ${chart.latest}`);
      upgradeSession.succeed();
      void runVersionAudit(clusterId, { force: true, source: "manual" });
    } finally {
      upgradingKey = null;
    }
  }

  async function bulkUpgradePatch() {
    const targets = patchOnly;
    if (targets.length === 0) return;
    const confirmed = await confirmAction(
      `Upgrade ${targets.length} chart(s) to the latest patch version?\n\n` +
        targets.map((c) => `  - ${c.name} (${c.version} -> ${c.latest ?? "?"})`).join("\n") +
        `\n\nCharts upgrade sequentially; progress is shown above.`,
      "Bulk patch upgrade",
    );
    if (!confirmed) return;
    bulkProgress = { total: targets.length, done: 0, current: null, failures: [] };
    upgradeSessionLabel = `Bulk patch upgrade (${targets.length} charts)`;
    upgradeSession.start();
    try {
      for (const chart of targets) {
        bulkProgress = { ...bulkProgress, current: chart.name };
        upgradingKey = chartKey(chart);
        upgradeSession.append(`\n--- ${chart.name} (${chart.version} -> ${chart.latest}) ---\n`);
        try {
          if (!chart.chartPath) {
            bulkProgress = {
              ...bulkProgress,
              failures: [...bulkProgress.failures, `${chart.name}: chart path unresolved`],
            };
            upgradeSession.append(`  skipped: chart path unresolved\n`);
            continue;
          }
          const result = await installOrUpgradeHelmRelease(clusterId, {
            releaseName: chart.name,
            chart: chart.chartPath,
            namespace: chart.namespace,
            createNamespace: false,
            chartVersion: chart.latest ?? undefined,
            onOutput: (chunk) => upgradeSession.append(chunk),
          });
          if (!result.success) {
            bulkProgress = {
              ...bulkProgress,
              failures: [
                ...bulkProgress.failures,
                `${chart.name}: ${result.error ?? "unknown error"}`,
              ],
            };
          }
        } finally {
          upgradingKey = null;
          bulkProgress = { ...bulkProgress, done: bulkProgress.done + 1 };
        }
      }
      const fails = bulkProgress.failures;
      if (fails.length === 0) {
        toast.success(`Upgraded ${targets.length} chart(s) to latest patch`);
        upgradeSession.succeed();
      } else {
        toast.error(`Bulk upgrade finished with ${fails.length} failure(s). First: ${fails[0]}`);
        upgradeSession.fail();
      }
      void runVersionAudit(clusterId, { force: true, source: "manual" });
    } finally {
      bulkProgress = null;
    }
  }

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

    {#if chartsWithErrors.length > 0}
      <Alert.Root variant="destructive">
        <Alert.Title>
          {chartsWithErrors.length} chart{chartsWithErrors.length === 1 ? "" : "s"} have lookup or state
          errors
        </Alert.Title>
        <Alert.Description>
          <ul class="list-disc pl-4 text-xs">
            {#each chartsWithErrors as chart}
              <li>
                <span class="font-medium">{chart.namespace}/{chart.name}:</span>
                {chart.error}
              </li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if cacheFreshness.isExpiringSoon || cacheFreshness.isStale}
      <div
        class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
      >
        <div class="flex items-center justify-between gap-2">
          <span>
            {cacheFreshness.isStale
              ? "Audit data is stale - cache expired. Re-run to get current state."
              : `Audit cache is ${Math.round(cacheFreshness.percent * 100)}% through its TTL - data may be drifting.`}
          </span>
          <Button
            variant="outline"
            size="sm"
            class="h-6 text-[11px]"
            onclick={runNow}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh now"}
          </Button>
        </div>
      </div>
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
        <p class="text-sm font-semibold text-foreground">
          {summary?.message ?? "Audit unavailable"}
        </p>
        <p class="text-xs text-muted-foreground">
          Charts status: {summary?.chartStatus ?? "unknown"}
        </p>
      </DiagnosticSummaryCard>
    </div>

    <CommandConsole session={upgradeSession} label={upgradeSessionLabel} />

    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-foreground">Installed Helm charts</h3>
          <Badge class="text-white {k8sStatusStyles[summary?.k8sStatus ?? 'unreachable']}">
            {summary?.k8sStatus ?? "unreachable"}
          </Badge>
        </div>
        {#if patchOnly.length > 0}
          <div class="flex items-center gap-2">
            {#if bulkProgress}
              <span class="text-xs text-amber-400">
                Upgrading {bulkProgress.current ?? "…"} ({bulkProgress.done}/{bulkProgress.total})
              </span>
            {/if}
            <Button
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              onclick={() => void bulkUpgradePatch()}
              disabled={Boolean(bulkProgress) || Boolean(upgradingKey)}
              title={`Run helm upgrade to latest for ${patchOnly.length} patch-level outdated chart(s)`}
            >
              Upgrade {patchOnly.length} patch version{patchOnly.length === 1 ? "" : "s"}
            </Button>
          </div>
        {/if}
      </div>
      <TableSurface maxHeightClass="">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Name</Table.TableHead>
              <Table.TableHead>Namespace</Table.TableHead>
              <Table.TableHead>Installed</Table.TableHead>
              <Table.TableHead>Latest</Table.TableHead>
              <Table.TableHead>Severity</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
              <Table.TableHead class="text-right">Actions</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if charts.length === 0}
              <Table.TableRow>
                <Table.TableCell colspan={7} class="py-4 text-center text-xs text-muted-foreground">
                  No Helm releases detected on this cluster. Install a chart from the
                  <a
                    href="?workload=helmcatalog"
                    class="text-sky-400 hover:underline"
                    data-sveltekit-preload-data="hover">Helm Catalog</a
                  > or via the Helm page.
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each charts as chart (chartKey(chart))}
                {@const sev = severity(chart.version, chart.latest)}
                {@const newFlag = isNewlyOutdated(chart)}
                {@const ahUrl = artifactHubUrl(chart)}
                {@const rowUpgrading = upgradingKey === chartKey(chart)}
                <Table.TableRow>
                  <Table.TableCell class="font-medium">
                    {chart.name}
                    {#if newFlag}
                      <Badge class="ml-1 bg-rose-600 text-white text-[9px]">NEW</Badge>
                    {/if}
                  </Table.TableCell>
                  <Table.TableCell>{chart.namespace}</Table.TableCell>
                  <Table.TableCell class="font-mono text-xs">{chart.version}</Table.TableCell>
                  <Table.TableCell class="font-mono text-xs">{chart.latest ?? "-"}</Table.TableCell>
                  <Table.TableCell>
                    {#if chart.status === "outdated"}
                      <Badge class="text-white text-[10px] {severityStyles[sev]}">
                        {severityLabels[sev]}
                      </Badge>
                    {:else}
                      <span class="text-[11px] text-muted-foreground">-</span>
                    {/if}
                  </Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {chartStatusStyles[chart.status]}">
                      {chartStatusLabels[chart.status]}
                    </Badge>
                  </Table.TableCell>
                  <Table.TableCell>
                    <div class="flex flex-wrap items-center justify-end gap-2">
                      {#if ahUrl}
                        <a
                          class="text-xs text-sky-400 hover:underline"
                          href={ahUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          title="Open Artifact Hub page with release notes and values schema"
                        >
                          Release notes
                        </a>
                      {:else if chart.repoUrl}
                        <a
                          class="text-xs text-sky-400 hover:underline"
                          href={chart.repoUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          title="Open chart repository"
                        >
                          Repo
                        </a>
                      {/if}
                      {#if chart.status === "outdated" && chart.chartPath}
                        <Button
                          variant="outline"
                          size="sm"
                          class="h-7 text-xs"
                          onclick={() => void upgradeChart(chart)}
                          disabled={Boolean(bulkProgress) ||
                            (Boolean(upgradingKey) && !rowUpgrading)}
                          title={`helm upgrade ${chart.name} -n ${chart.namespace} --version ${chart.latest ?? "latest"}`}
                        >
                          {rowUpgrading ? "Upgrading…" : "Upgrade"}
                        </Button>
                      {/if}
                    </div>
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
