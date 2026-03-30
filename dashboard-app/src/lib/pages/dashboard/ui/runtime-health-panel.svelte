<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    clusterStates,
    getGlobalWatcherRuntimeSummary,
    getWatcherTelemetrySummary,
    listWatcherTelemetryClusterRows,
    listGlobalWatcherRuntimeRows,
  } from "$features/check-health";
  import {
    dashboardDataProfile,
    resolveClusterRuntimeBudget,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    activeCapabilityDiscoveryClusterIds,
    activeDiagnosticsClusterIds,
    activeMetricsClusterIds,
    activeResourceSyncClusterIds,
  } from "$shared/lib/cluster-runtime-manager";

  let refreshToken = $state(0);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function refreshTelemetry() {
    refreshToken += 1;
  }

  // Re-read snapshots on every token bump
  const watcherTelemetrySummary = $derived.by(() => {
    refreshToken;
    return getWatcherTelemetrySummary();
  });
  const watcherRuntimeSummary = $derived.by(() => {
    refreshToken;
    return getGlobalWatcherRuntimeSummary();
  });
  const watcherClusterRows = $derived.by(() => {
    refreshToken;
    return listWatcherTelemetryClusterRows().slice(0, 8);
  });
  const watcherRuntimeRows = $derived.by(() => {
    refreshToken;
    return listGlobalWatcherRuntimeRows().slice(0, 8);
  });
  const effectiveBudget = $derived(resolveClusterRuntimeBudget($dashboardDataProfile));

  // Also refresh when clusterStates store changes (watcher starts/finishes)
  const _clusterStatesRefresh = $derived.by(() => {
    $clusterStates;
    refreshToken += 1;
    return null;
  });

  function formatAt(value: number | null) {
    if (!value) return "n/a";
    return new Date(value).toLocaleTimeString();
  }

  function formatDuration(ms: number | null) {
    if (ms === null) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatLastEventLabel(row: {
    lastEventAt: number | null;
    lastKind: string | null;
    lastTransport: string | null;
  }) {
    const parts = [formatAt(row.lastEventAt)];
    if (row.lastKind) parts.push(row.lastKind);
    if (row.lastTransport) parts.push(row.lastTransport);
    return parts.join(" • ");
  }

  onMount(() => {
    refreshTelemetry();
    // Poll every 5s so counters stay fresh even without events
    pollTimer = setInterval(refreshTelemetry, 5_000);
    const handler = () => refreshTelemetry();
    window.addEventListener("runtime:telemetry", handler as EventListener);
    return () => {
      window.removeEventListener("runtime:telemetry", handler as EventListener);
    };
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<section class="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
  <div class="space-y-1">
    <h3 class="text-sm font-semibold">Runtime Health</h3>
    <p class="text-xs text-muted-foreground">
      Production watcher counters, relists, retries, fallback rate, and active runtime planes.
    </p>
  </div>

  <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Watcher events</div>
      <div class="mt-1 font-semibold">{watcherTelemetrySummary.sampleSize}</div>
      <div class="text-xs text-muted-foreground">last: {formatAt(watcherTelemetrySummary.lastEventAt)}</div>
    </div>
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Refresh / diagnostics</div>
      <div class="mt-1 font-semibold">
        {watcherTelemetrySummary.activeSessions} watcher / {watcherRuntimeSummary.activeDiagnosticsUpdates} diag
      </div>
      <div class="text-xs text-muted-foreground">
        active {watcherRuntimeSummary.activeRefreshUpdates}/{watcherRuntimeSummary.maxConcurrentRefreshUpdates}
        refresh • {watcherRuntimeSummary.activeDiagnosticsUpdates}/{watcherRuntimeSummary.maxConcurrentDiagnosticsUpdates}
        diag
      </div>
    </div>
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Retry / relist / queue</div>
      <div class="mt-1 font-semibold">
        {watcherTelemetrySummary.retryScheduledCount} / {watcherTelemetrySummary.relistCount}
      </div>
      <div class="text-xs text-muted-foreground">
        queued {watcherRuntimeSummary.pendingRefreshUpdates} refresh / {watcherRuntimeSummary.pendingDiagnosticsUpdates} diag
      </div>
    </div>
    <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Runtime policy</div>
      <div class="mt-1 font-semibold">
        {effectiveBudget.maxConcurrentClusterRefreshes} refresh / {effectiveBudget.maxConcurrentDiagnostics} diag
      </div>
      <div class="text-xs text-muted-foreground">
        {effectiveBudget.metricsReadPolicy} metrics • {effectiveBudget.capabilityDiscoveryMode} capability
      </div>
      <div class="mt-1 text-xs text-muted-foreground">
        {$activeResourceSyncClusterIds.length} sync / {$activeDiagnosticsClusterIds.length} diag / {$activeMetricsClusterIds.length} metrics / {$activeCapabilityDiscoveryClusterIds.length} capability
      </div>
    </div>
  </div>

  <div class="mt-4 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Active watcher rows</div>
    {#if watcherRuntimeRows.length === 0}
      <div class="text-sm text-muted-foreground">No active watchers.</div>
    {:else}
      <table class="min-w-full text-left text-sm">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="pr-3">Cluster</th>
            <th class="pr-3">State</th>
            <th class="pr-3">Kind</th>
            <th class="pr-3">Interval</th>
            <th class="pr-3">Last run</th>
            <th class="pr-3">Last settled</th>
          </tr>
        </thead>
        <tbody>
          {#each watcherRuntimeRows as row (row.clusterId)}
            <tr class="border-t border-border/40">
              <td class="py-1.5 pr-3 font-mono text-xs truncate max-w-[120px]" title={row.clusterId}>{row.clusterId.slice(0, 8)}</td>
              <td class="pr-3">
                {#if row.loading}
                  <span class="text-amber-500 font-medium">running</span>
                {:else if row.pending}
                  <span class="text-sky-500">queued</span>
                {:else}
                  <span class="text-emerald-500">idle</span>
                {/if}
              </td>
              <td class="pr-3 text-xs">{row.activeKind ?? row.pendingKind ?? "-"}</td>
              <td class="pr-3 text-xs">{row.intervalMs ? `${Math.round(row.intervalMs / 1000)}s` : "-"}</td>
              <td class="pr-3 text-xs">{formatDuration(row.lastDurationMs)}</td>
              <td class="pr-3 text-xs text-muted-foreground">{formatAt(row.lastSettledAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>
