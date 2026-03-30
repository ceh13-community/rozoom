<script lang="ts">
  import { onMount } from "svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    deprecationScanConfig,
    deprecationScanState,
    getTrustLevelLabel,
    runDeprecationScan,
    startDeprecationScanPolling,
    stopDeprecationScanPolling,
  } from "$features/deprecation-scan";
  import type { DeprecationIssue, DeprecationTrustLevel } from "$features/deprecation-scan";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import * as Popover from "$shared/ui/popover";
  import * as Table from "$shared/ui/table";
  import { Check, Clock4, Info, Refresh } from "$shared/ui/icons";
  import * as Alert from "$shared/ui/alert";
  import TableSurface from "$shared/ui/table-surface.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import DiagnosticSummaryCard from "$shared/ui/diagnostic-summary-card.svelte";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  const scanState = $derived($deprecationScanState[clusterId]);
  const summary = $derived(scanState?.summary ?? null);
  const history = $derived(scanState?.history ?? []);
  const latestRun = $derived(history[0] ?? null);
  const config = $derived($deprecationScanConfig);
  const combinedIssues = $derived<DeprecationIssue[]>(
    latestRun ? [...latestRun.issues, ...latestRun.helmIssues] : [],
  );
  const totalDeprecated = $derived(
    summary ? summary.deprecatedCount + summary.helmDeprecatedCount : 0,
  );
  const sortedIssues = $derived(
    [...combinedIssues].sort((a, b) => {
      if (a.status !== b.status) return a.status === "removed" ? -1 : 1;
      const aCount = a.requestCount ?? 0;
      const bCount = b.requestCount ?? 0;
      if (aCount !== bCount) return bCount - aCount;
      return a.kind.localeCompare(b.kind);
    }),
  );

  let scanRunning = $state(false);
  let fullScanRunning = $state(false);
  let scanActionMessage = $state<string | null>(null);
  let scanActionError = $state<string | null>(null);
  let pageVisible = $state(true);
  let scanRequestId = 0;
  let fullScanRequestId = 0;
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const statusStyles: Record<string, string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    critical: "bg-rose-600",
    unavailable: "bg-slate-500",
    needsConfig: "bg-indigo-500",
  };

  const statusLabels: Record<string, string> = {
    ok: "OK",
    warning: "Warning",
    critical: "Critical",
    unavailable: "Unavailable",
    needsConfig: "Need configuration",
  };

  const issueStatusStyles: Record<string, string> = {
    deprecated: "bg-amber-500",
    removed: "bg-rose-600",
  };

  const scopeStyles: Record<string, string> = {
    observed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    fullScan: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
    helmTemplate: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  };

  const scopeLabels: Record<string, string> = {
    observed: "Observed metrics",
    fullScan: "Full scan",
    helmTemplate: "Helm template",
  };

  const trustStyles: Record<DeprecationTrustLevel, string> = {
    full: "bg-emerald-600",
    mixed: "bg-amber-500",
    observed: "bg-slate-500",
    limited: "bg-rose-600",
  };

  function formatDate(value: string | null) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function formatDuration(ms: number) {
    const hours = Math.round(ms / (60 * 60 * 1000));
    return `${hours}h`;
  }

  async function runNow() {
    if (!clusterId || scanRunning || fullScanRunning) return;
    const requestId = ++scanRequestId;
    const activeClusterId = clusterId;
    scanRunning = true;
    scanActionError = null;
    scanActionMessage = "Starting scan";
    try {
      await runDeprecationScan(activeClusterId, { force: true, source: "manual" });
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      scanActionMessage = `Scan completed at ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      scanActionError = error instanceof Error ? error.message : "Failed to run scan";
      scanActionMessage = null;
    } finally {
      if (requestId !== scanRequestId || activeClusterId !== clusterId) return;
      scanRunning = false;
    }
  }

  async function runFullScanNow() {
    if (!clusterId || scanRunning || fullScanRunning) return;
    const requestId = ++fullScanRequestId;
    const activeClusterId = clusterId;
    fullScanRunning = true;
    scanActionError = null;
    scanActionMessage = "Starting full Pluto scan";
    try {
      await runDeprecationScan(activeClusterId, { force: true, source: "manual" });
      if (requestId !== fullScanRequestId || activeClusterId !== clusterId) return;
      scanActionMessage = `Full scan completed at ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      if (requestId !== fullScanRequestId || activeClusterId !== clusterId) return;
      scanActionError = error instanceof Error ? error.message : "Failed to run full scan";
      scanActionMessage = null;
    } finally {
      if (requestId !== fullScanRequestId || activeClusterId !== clusterId) return;
      fullScanRunning = false;
    }
  }

  $effect(() => {
    clusterId;
    scanRequestId += 1;
    fullScanRequestId += 1;
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

    if (!autoDiagnosticsEnabled) {
      stopDeprecationScanPolling(clusterId);
      return;
    }

    if (!pageVisible) {
      stopDeprecationScanPolling(clusterId);
      return;
    }

    startDeprecationScanPolling(clusterId);

    return () => {
      stopDeprecationScanPolling(clusterId);
    };
  });
</script>

<Card.Root class="bg-card text-card-foreground">
  <Card.Header class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <h2
          class="text-lg font-semibold"
          title="Observed and full scan signals for deprecated or removed Kubernetes API versions."
        >
          Deprecated API Exposure
        </h2>
        {#if summary}
          <Badge class="text-white {statusStyles[summary.status]}">
            {statusLabels[summary.status]}
          </Badge>
          <Badge class="text-white {trustStyles[summary.trustLevel]}">
            {getTrustLevelLabel(summary.trustLevel)}
          </Badge>
        {/if}
        <Popover.Root>
          <Popover.Trigger>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Deprecation scan info"
              title="About API deprecation tools"
            >
              <Info class="h-4 w-4" />
            </Button>
          </Popover.Trigger>
          <Popover.Content class="w-[420px] space-y-3" sideOffset={8}>
            <p class="text-sm font-semibold text-foreground">Deprecation scan sources</p>
            <div class="space-y-2 text-xs text-muted-foreground">
              <p>
                <span class="font-medium text-foreground">Pluto:</span>
                scans rendered manifests and detects deprecated/removed Kubernetes APIs.
              </p>
              <p>
                <span class="font-medium text-foreground">Observed API usage:</span>
                validates deprecations based on live cluster request activity.
              </p>
            </div>
            <div class="space-y-1 text-xs">
              <a
                class="text-primary underline-offset-4 hover:underline"
                href="https://github.com/FairwindsOps/pluto"
                target="_blank"
                rel="noreferrer noopener"
              >
                Pluto GitHub
              </a>
              <a
                class="block text-primary underline-offset-4 hover:underline"
                href="https://kubernetes.io/docs/reference/using-api/deprecation-guide/"
                target="_blank"
                rel="noreferrer noopener"
              >
                Kubernetes API Deprecation Guide
              </a>
            </div>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onclick={runNow}
          loading={scanRunning}
          loadingLabel="Refreshing"
          disabled={fullScanRunning}
        >
          <Refresh class="mr-2 h-4 w-4" />
          <span>Refresh status</span>
        </Button>
        <Button
          variant="outline"
          onclick={runFullScanNow}
          loading={fullScanRunning}
          loadingLabel="Running full scan"
          disabled={scanRunning}
        >
          <Check class="mr-2 h-4 w-4" />
          <span>Run full scan (Pluto)</span>
        </Button>
      </div>
    </div>
    <p class="text-sm text-muted-foreground">
      Primary source: live observed API requests. Preferred source: full Pluto scan for object-level
      upgrade readiness.
    </p>
    {#if scanActionMessage}
      <p
        class="inline-flex w-fit items-center rounded-md border border-emerald-300/60 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
      >
        {scanActionMessage}{#if scanActionMessage.startsWith("Starting")}<LoadingDots />{/if}
      </p>
    {/if}
    {#if scanActionError}
      <p class="text-xs text-rose-600">{scanActionError}</p>
    {/if}
  </Card.Header>
  <Card.Content class="space-y-6">
    {#if summary?.status === "unavailable"}
      <Alert.Root variant="destructive">
        <Alert.Title>Scan unavailable</Alert.Title>
        <Alert.Description>{summary?.message ?? "Unable to run scan sources."}</Alert.Description>
      </Alert.Root>
    {:else if summary?.status === "needsConfig"}
      <Alert.Root variant="default">
        <Alert.Title>Need configuration</Alert.Title>
        <Alert.Description>
          Set a target Kubernetes version to enable deprecation scanning.
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if summary?.errors?.length}
      <Alert.Root variant="destructive">
        <Alert.Title>Source errors</Alert.Title>
        <Alert.Description>
          <ul class="list-disc pl-4 text-xs">
            {#each summary.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    {#if summary?.warnings?.length}
      <Alert.Root>
        <Alert.Title>Coverage warnings</Alert.Title>
        <Alert.Description>
          <ul class="list-disc pl-4 text-xs">
            {#each summary.warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DiagnosticSummaryCard title="Resources with deprecated API">
        <p class="text-2xl font-semibold text-foreground">{summary?.deprecatedCount ?? 0}</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Helm charts with deprecated API">
        <p class="text-2xl font-semibold text-foreground">{summary?.helmDeprecatedCount ?? 0}</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Critical (removed by target)">
        <p class="text-2xl font-semibold text-foreground">{summary?.criticalCount ?? 0}</p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Target Kubernetes version">
        <p class="text-sm font-semibold text-foreground">{summary?.targetVersion ?? "-"}</p>
        <p class="mt-1 text-xs text-muted-foreground">Auto-detected from cluster version.</p>
        <p class="text-xs text-muted-foreground">Cluster version: {summary?.clusterVersion ?? "Unknown"}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last scan">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock4 class="h-4 w-4" /> Last scan
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
      <DiagnosticSummaryCard title="Deprecation scan status">
        <p class="text-sm font-semibold text-foreground">
          {summary?.message ?? "Scan unavailable"}
        </p>
        <p class="text-xs text-muted-foreground">Total deprecated findings: {totalDeprecated}</p>
      </DiagnosticSummaryCard>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-foreground">Source health</h3>
      <TableSurface maxHeightClass="">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Source</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
              <Table.TableHead>Findings</Table.TableHead>
              <Table.TableHead>Message</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if !summary?.sourceSummaries?.length}
              <Table.TableRow>
                <Table.TableCell colspan={4} class="text-center">
                  <TableEmptyState message="No results for the current filter." />
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each summary.sourceSummaries as source}
                <Table.TableRow>
                  <Table.TableCell>{source.label}</Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {statusStyles[source.status]}">{statusLabels[source.status]}</Badge>
                  </Table.TableCell>
                  <Table.TableCell>{source.findings}</Table.TableCell>
                  <Table.TableCell>{source.message}</Table.TableCell>
                </Table.TableRow>
              {/each}
            {/if}
          </Table.TableBody>
        </Table.Table>
      </TableSurface>
    </div>

    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-foreground">Findings</h3>
        <Badge class="text-white {statusStyles[summary?.status ?? "unavailable"]}">
          {statusLabels[summary?.status ?? "unavailable"]}
        </Badge>
      </div>
      <TableSurface maxHeightClass="">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Kind</Table.TableHead>
              <Table.TableHead>Namespace</Table.TableHead>
              <Table.TableHead>Name</Table.TableHead>
              <Table.TableHead>apiVersion</Table.TableHead>
              <Table.TableHead>Scope</Table.TableHead>
              <Table.TableHead>Requests</Table.TableHead>
              <Table.TableHead>Replacement version</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if sortedIssues.length === 0}
              <Table.TableRow>
                <Table.TableCell colspan={8} class="text-center">
                  <TableEmptyState message="No results for the current filter." />
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each sortedIssues as issue}
                <Table.TableRow>
                  <Table.TableCell>{issue.kind}</Table.TableCell>
                  <Table.TableCell>{issue.namespace || "-"}</Table.TableCell>
                  <Table.TableCell>{issue.name}</Table.TableCell>
                  <Table.TableCell>{issue.apiVersion}</Table.TableCell>
                  <Table.TableCell>
                    <span class="inline-flex rounded px-2 py-0.5 text-xs {scopeStyles[issue.scope]}">
                      {scopeLabels[issue.scope]}
                    </span>
                  </Table.TableCell>
                  <Table.TableCell>{issue.requestCount ?? "-"}</Table.TableCell>
                  <Table.TableCell>{issue.replacementVersion}</Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {issueStatusStyles[issue.status]}">
                      {issue.status}
                    </Badge>
                  </Table.TableCell>
                </Table.TableRow>
              {/each}
            {/if}
          </Table.TableBody>
        </Table.Table>
      </TableSurface>
    </div>

    <div class="space-y-3">
      <h3 class="text-sm font-semibold text-foreground">Recent history</h3>
      <TableSurface maxHeightClass="">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Run time</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
              <Table.TableHead>Trust</Table.TableHead>
              <Table.TableHead>Deprecated</Table.TableHead>
              <Table.TableHead>Critical</Table.TableHead>
              <Table.TableHead>Source</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if history.length === 0}
              <Table.TableRow>
                <Table.TableCell colspan={6} class="text-center">
                  <TableEmptyState message="No results for the current filter." />
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each history as run}
                <Table.TableRow>
                  <Table.TableCell>{formatDate(run.runAt)}</Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {statusStyles[run.status]}">
                      {statusLabels[run.status]}
                    </Badge>
                  </Table.TableCell>
                  <Table.TableCell>{getTrustLevelLabel(run.trustLevel)}</Table.TableCell>
                  <Table.TableCell>{run.deprecatedCount + run.helmDeprecatedCount}</Table.TableCell>
                  <Table.TableCell>{run.criticalCount}</Table.TableCell>
                  <Table.TableCell>{run.source}</Table.TableCell>
                </Table.TableRow>
              {/each}
            {/if}
          </Table.TableBody>
        </Table.Table>
      </TableSurface>
    </div>

    {#if latestRun?.notes?.length}
      <div class="space-y-2">
        <h3 class="text-sm font-semibold text-foreground">Notes</h3>
        <ul class="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {#each latestRun.notes as note}
            <li>{note}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
