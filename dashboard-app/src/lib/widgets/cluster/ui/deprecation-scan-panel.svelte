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
  import { Info, Refresh } from "$shared/ui/icons";
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
  let dismissedScanErrors = $state(false);
  let dismissedScanWarnings = $state(false);
  let dismissedUnavailable = $state(false);
  let dismissedNeedsConfig = $state(false);

  $effect(() => {
    if (!scanActionMessage || scanActionMessage.startsWith("Starting")) return;
    const t = setTimeout(() => (scanActionMessage = null), 6000);
    return () => clearTimeout(t);
  });

  $effect(() => {
    latestRun;
    dismissedScanErrors = false;
    dismissedScanWarnings = false;
    dismissedUnavailable = false;
    dismissedNeedsConfig = false;
  });
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

  const issueStatusLabels: Record<string, string> = {
    deprecated: "Deprecated",
    removed: "Removed",
  };

  const sourceLabels: Record<string, string> = {
    auto: "Auto",
    manual: "Manual",
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
      await runDeprecationScan(activeClusterId, {
        force: true,
        source: "manual",
        forcePluto: true,
      });
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
          <Badge
            class="text-white {trustStyles[summary.trustLevel]}"
            title="Scan confidence: full = Pluto scanned all manifests; mixed = Pluto + observed metrics; observed = live API metrics only; limited = partial data"
          >
            Confidence: {getTrustLevelLabel(summary.trustLevel)}
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
          title="Re-run the last scan using cached Helm data (fast)"
        >
          <Refresh class="mr-2 h-4 w-4" />
          <span>Quick refresh</span>
        </Button>
        <Button
          class="bg-emerald-600 text-white hover:bg-emerald-700"
          onclick={runFullScanNow}
          loading={fullScanRunning}
          loadingLabel="Scanning"
          disabled={scanRunning}
          title="Force Pluto to scan all rendered manifests regardless of settings - slower but catches all deprecated API usage"
        >
          <Refresh class="mr-2 h-4 w-4" />
          <span>Full Pluto scan</span>
        </Button>
      </div>
    </div>
    <p class="text-sm text-muted-foreground">
      Detects deprecated and removed Kubernetes API usage. Use
      <span class="text-foreground">Quick refresh</span> for cached results,
      <span class="text-foreground">Full Pluto scan</span> for a deep manifest scan.
    </p>
    {#if scanActionMessage}
      <div
        class="inline-flex w-fit items-center gap-2 rounded-md border border-emerald-300/60 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
      >
        <span
          >{scanActionMessage}{#if scanActionMessage.startsWith("Starting")}<LoadingDots
            />{/if}</span
        >
        <button
          type="button"
          class="opacity-60 hover:opacity-100"
          aria-label="Dismiss"
          onclick={() => (scanActionMessage = null)}>✕</button
        >
      </div>
    {/if}
    {#if scanActionError}
      <div class="flex items-center gap-2">
        <p class="text-xs text-rose-600">{scanActionError}</p>
        <button
          type="button"
          class="text-xs text-muted-foreground hover:text-foreground"
          aria-label="Dismiss error"
          onclick={() => (scanActionError = null)}>✕</button
        >
      </div>
    {/if}
  </Card.Header>
  <Card.Content class="space-y-6">
    {#if summary?.status === "ok" && sortedIssues.length === 0}
      <div
        class="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400"
      >
        <span class="text-base">✓</span>
        <span
          >No deprecated APIs detected. Cluster is clean against target version {summary.targetVersion}.</span
        >
      </div>
    {/if}

    {#if summary?.status === "unavailable" && !dismissedUnavailable}
      <Alert.Root variant="destructive">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>Scan unavailable</Alert.Title>
            <Alert.Description
              >{summary?.message ?? "Unable to run scan sources."}</Alert.Description
            >
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (dismissedUnavailable = true)}>✕</button
          >
        </div>
      </Alert.Root>
    {:else if summary?.status === "needsConfig" && !dismissedNeedsConfig}
      <Alert.Root variant="default">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>Configuration required</Alert.Title>
            <Alert.Description>
              The target Kubernetes version could not be detected automatically. Try running
              <span class="font-medium text-foreground">Full Pluto scan</span> - it will re-read the
              cluster version. If the cluster is offline or unreachable, check the connection first.
            </Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (dismissedNeedsConfig = true)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    {#if summary?.errors?.length && !dismissedScanErrors}
      <Alert.Root variant="destructive">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>Source errors</Alert.Title>
            <Alert.Description>
              <ul class="list-disc pl-4 text-xs">
                {#each summary.errors as err}
                  <li>{err}</li>
                {/each}
              </ul>
            </Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (dismissedScanErrors = true)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    {#if summary?.warnings?.length && !dismissedScanWarnings}
      <Alert.Root>
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <Alert.Title>Coverage warnings</Alert.Title>
            <Alert.Description>
              <ul class="list-disc pl-4 text-xs">
                {#each summary.warnings as warning}
                  <li>{warning}</li>
                {/each}
              </ul>
            </Alert.Description>
          </div>
          <button
            type="button"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
            onclick={() => (dismissedScanWarnings = true)}>✕</button
          >
        </div>
      </Alert.Root>
    {/if}

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <DiagnosticSummaryCard title="Resources with deprecated API">
        <p class="text-2xl font-semibold text-foreground">
          {summary ? summary.deprecatedCount : "-"}
        </p>
        {#if !summary}
          <p class="text-xs text-muted-foreground">Run a scan to populate</p>
        {/if}
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Helm charts with deprecated API">
        <p class="text-2xl font-semibold text-foreground">
          {summary ? summary.helmDeprecatedCount : "-"}
        </p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Critical (removed by target)">
        <p class="text-2xl font-semibold text-foreground">
          {summary ? summary.criticalCount : "-"}
        </p>
      </DiagnosticSummaryCard>
      <DiagnosticSummaryCard title="Target Kubernetes version">
        <p class="text-sm font-semibold text-foreground">{summary?.targetVersion ?? "-"}</p>
        <p class="mt-1 text-xs text-muted-foreground">Auto-detected from cluster version.</p>
        <p class="text-xs text-muted-foreground">
          Cluster version: {summary?.clusterVersion ?? "Unknown"}
        </p>
      </DiagnosticSummaryCard>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <DiagnosticSummaryCard title="Last scan">
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
                  <TableEmptyState
                    message={summary
                      ? "No source data returned by the last scan."
                      : "Run a full Pluto scan to populate source health."}
                  />
                </Table.TableCell>
              </Table.TableRow>
            {:else}
              {#each summary.sourceSummaries as source}
                <Table.TableRow>
                  <Table.TableCell>{source.label}</Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {statusStyles[source.status]}"
                      >{statusLabels[source.status]}</Badge
                    >
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
      <h3 class="text-sm font-semibold text-foreground">Findings</h3>
      <TableSurface maxHeightClass="">
        <Table.Table>
          <Table.TableHeader>
            <Table.TableRow>
              <Table.TableHead>Kind</Table.TableHead>
              <Table.TableHead>Namespace</Table.TableHead>
              <Table.TableHead>Name</Table.TableHead>
              <Table.TableHead>API version</Table.TableHead>
              <Table.TableHead>Scope</Table.TableHead>
              <Table.TableHead
                title="Number of API calls observed in audit logs for this deprecated resource"
                >API calls</Table.TableHead
              >
              <Table.TableHead>Replacement version</Table.TableHead>
              <Table.TableHead>Status</Table.TableHead>
            </Table.TableRow>
          </Table.TableHeader>
          <Table.TableBody>
            {#if sortedIssues.length === 0}
              <Table.TableRow>
                <Table.TableCell colspan={8} class="text-center">
                  <TableEmptyState
                    message={summary
                      ? "No deprecated APIs found - your cluster looks clean."
                      : "Run a scan first to see deprecated API findings."}
                  />
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
                    <span
                      class="inline-flex rounded px-2 py-0.5 text-xs {scopeStyles[issue.scope]}"
                    >
                      {scopeLabels[issue.scope]}
                    </span>
                  </Table.TableCell>
                  <Table.TableCell>
                    <span
                      title={issue.requestCount == null
                        ? issue.scope === "observed"
                          ? "No API call data yet — metrics may not have been collected for this resource"
                          : "N/A — detected by static scan, not live API metrics"
                        : `${issue.requestCount} API calls recorded for this resource`}
                      >{issue.requestCount ?? "-"}</span
                    >
                  </Table.TableCell>
                  <Table.TableCell>{issue.replacementVersion}</Table.TableCell>
                  <Table.TableCell>
                    <Badge class="text-white {issueStatusStyles[issue.status]}">
                      {issueStatusLabels[issue.status] ?? issue.status}
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
                  <TableEmptyState message="No scans have been run yet." />
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
                  <Table.TableCell>
                    <Badge class="text-white {trustStyles[run.trustLevel]}">
                      {getTrustLevelLabel(run.trustLevel)}
                    </Badge>
                  </Table.TableCell>
                  <Table.TableCell>{run.deprecatedCount + run.helmDeprecatedCount}</Table.TableCell>
                  <Table.TableCell>{run.criticalCount}</Table.TableCell>
                  <Table.TableCell>{sourceLabels[run.source] ?? run.source}</Table.TableCell>
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
