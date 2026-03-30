<script lang="ts">
  import { onMount } from "svelte";
  import {
    clusterHealthChecks,
    getGlobalWatcherRuntimeSummary,
    getWatcherTelemetrySummary,
    listGlobalWatcherRuntimeRows,
    resetWatcherTelemetry,
  } from "$features/check-health";
  import { clearWorkloadEvents, listWorkloadEvents } from "$features/workloads-management";
  import { Button } from "$shared/ui/button";
  import type { AppClusterConfig } from "$entities/config";
  import {
    resolveSyntheticRefreshProfile,
    SYNTHETIC_STRESS_PRESETS,
    type SyntheticStressPreset,
  } from "../model/synthetic-fleet";
  import type { ClusterHealthChecks } from "$features/check-health/model/types";

  let { fleetSize, clusters }: { fleetSize: number; clusters: AppClusterConfig[] } = $props();

  let refreshToken = $state(0);
  let waveCursor = $state(0);
  let syntheticQueue = $state<string[]>([]);
  let syntheticRunning = $state<string[]>([]);
  let syntheticLastDuration = $state<Record<string, number>>({});
  let syntheticLastCompletedAt = $state<Record<string, number>>({});
  let syntheticSamples = $state<Record<string, number>>({});
  let autoStressRunning = $state(false);
  let selectedPreset = $state<SyntheticStressPreset>("balanced");
  let currentRunDurations = $state<number[]>([]);
  let currentRunPeakQueue = $state(0);
  let currentRunSaturatedClusters = $state<string[]>([]);
  type SyntheticPresetReport = {
    completedAt: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    peakQueue: number;
    saturatedCount: number;
    verdict: string;
  };
  type SyntheticHistorySnapshot = {
    savedAt: number;
    fleetSize: number;
    reports: Partial<Record<SyntheticStressPreset, SyntheticPresetReport>>;
  };
  type SyntheticHistoryStorage = {
    fleetSize: number;
    snapshots: SyntheticHistorySnapshot[];
  };
  let presetReports = $state<
    Partial<Record<SyntheticStressPreset, SyntheticPresetReport>>
  >({});
  let comparisonHistory = $state<SyntheticHistorySnapshot[]>([]);
  let comparisonBaseline = $state<SyntheticHistorySnapshot | null>(null);
  let lastRunReport = $state<{
    completedAt: number | null;
    sampleSize: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    peakQueue: number;
    saturatedCount: number;
    preset?: SyntheticStressPreset;
  }>({
    completedAt: null,
    sampleSize: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
    peakQueue: 0,
    saturatedCount: 0,
    preset: undefined,
  });
  const PRESET_REGRESSION_THRESHOLDS = {
    p95Ms: 2_500,
    maxMs: 4_500,
    peakQueue: 14,
    saturatedCount: 18,
  } as const;

  function getHistoryStorageKey() {
    return `synthetic-fleet-comparison-history:${fleetSize}`;
  }

  function refreshTelemetry() {
    refreshToken += 1;
  }

  function percentile(values: number[], p: number) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
    return sorted[index] ?? null;
  }

  function formatDuration(value: number | null) {
    if (value == null || !Number.isFinite(value)) return "n/a";
    return `${Math.round(value)}ms`;
  }

  function formatAt(value: number | null) {
    if (!value) return "n/a";
    return new Date(value).toLocaleTimeString();
  }

  function formatDelta(value: number | null) {
    if (value == null || value === 0) return "0ms";
    const prefix = value > 0 ? "+" : "";
    return `${prefix}${Math.round(value)}ms`;
  }

  function readComparisonHistory(): SyntheticHistorySnapshot[] {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(getHistoryStorageKey());
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SyntheticHistoryStorage | SyntheticHistorySnapshot;
      if (!parsed || typeof parsed !== "object") return [];
      if ("snapshots" in parsed) {
        return parsed.fleetSize === fleetSize ? parsed.snapshots : [];
      }
      return parsed.fleetSize === fleetSize ? [parsed] : [];
    } catch {
      return [];
    }
  }

  function writeComparisonHistory(reports: Partial<Record<SyntheticStressPreset, SyntheticPresetReport>>) {
    if (typeof window === "undefined") return;
    const snapshot: SyntheticHistorySnapshot = {
      savedAt: Date.now(),
      fleetSize,
      reports,
    };
    const nextHistory = [...comparisonHistory, snapshot].slice(-8);
    const payload: SyntheticHistoryStorage = {
      fleetSize,
      snapshots: nextHistory,
    };
    window.localStorage.setItem(getHistoryStorageKey(), JSON.stringify(payload));
    comparisonHistory = nextHistory;
  }

  function clearComparisonHistory() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(getHistoryStorageKey());
    comparisonHistory = [];
    comparisonBaseline = null;
  }

  function extractDurations(metric: string) {
    refreshToken;
    return listWorkloadEvents()
      .filter((event) => event.name === metric)
      .map((event) => event.payload?.durationMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  }

  const watcherSummary = $derived.by(() => {
    refreshToken;
    return getWatcherTelemetrySummary();
  });
  const watcherRuntimeSummary = $derived.by(() => {
    refreshToken;
    return getGlobalWatcherRuntimeSummary();
  });

  const workloadEvents = $derived.by(() => {
    refreshToken;
    return listWorkloadEvents();
  });

  const fleetStats = $derived.by(() => {
    const checks = $clusterHealthChecks;
    let hydrated = 0;
    let offline = 0;
    let healthy = 0;
    let warning = 0;
    let critical = 0;

    for (const cluster of clusters) {
      const latestCheck = checks[cluster.uuid];
      if (latestCheck) hydrated += 1;
      const latestHealthCheck =
        latestCheck && !("errors" in latestCheck)
          ? (latestCheck as ClusterHealthChecks)
          : null;
      if (cluster.offline) {
        offline += 1;
        continue;
      }
      const status = latestHealthCheck?.apiServerHealth?.status ?? "ok";
      if (status === "critical") critical += 1;
      else if (status === "warning") warning += 1;
      else healthy += 1;
    }

    return {
      total: clusters.length,
      hydrated,
      pending: Math.max(0, clusters.length - hydrated),
      offline,
      healthy,
      warning,
      critical,
    };
  });

  const overviewDurations = $derived(extractDurations("overview.refresh.duration"));
  const workloadDurations = $derived(extractDurations("workloads.refresh_duration"));
  const overviewP95 = $derived(percentile(overviewDurations, 0.95));
  const workloadsP95 = $derived(percentile(workloadDurations, 0.95));
  const perfAlertCount = $derived(
    workloadEvents.filter((event) => event.name === "perf_budget_alert").length,
  );
  const topSlowCards = $derived.by(() => {
    refreshToken;
    const runtimeRows = listGlobalWatcherRuntimeRows();
    const syntheticRows = clusters.map((cluster) => ({
      clusterId: cluster.uuid,
      latestDurationMs: syntheticLastDuration[cluster.uuid] ?? null,
      p95DurationMs: syntheticLastDuration[cluster.uuid] ?? null,
      samples: syntheticSamples[cluster.uuid] ?? 0,
      lastAt: syntheticLastCompletedAt[cluster.uuid] ?? null,
      pending: syntheticQueue.includes(cluster.uuid),
      loading: syntheticRunning.includes(cluster.uuid),
    }));
    const realRows = runtimeRows
      .map((row) => ({
        clusterId: row.clusterId,
        latestDurationMs: row.lastDurationMs,
        p95DurationMs: row.lastDurationMs,
        samples: row.lastDurationMs == null ? 0 : 1,
        lastAt: row.lastSettledAt,
        pending: row.pending,
        loading: row.loading,
      }));
    const merged = [...syntheticRows, ...realRows].reduce<
      Map<
        string,
        {
          clusterId: string;
          latestDurationMs: number | null;
          p95DurationMs: number | null;
          samples: number;
          lastAt: number | null;
          pending: boolean;
          loading: boolean;
        }
      >
    >((rows, row) => {
      const current = rows.get(row.clusterId);
      if (!current || (row.latestDurationMs ?? -1) >= (current.latestDurationMs ?? -1)) {
        rows.set(row.clusterId, row);
      }
      return rows;
    }, new Map());

    return [...merged.values()]
      .sort((left, right) => (right.latestDurationMs ?? 0) - (left.latestDurationMs ?? 0))
      .slice(0, 8);
  });

  const syntheticRuntimeSummary = $derived.by(() => {
    refreshToken;
    return {
      active: syntheticRunning.length,
      queued: syntheticQueue.length,
      sampled: Object.keys(syntheticSamples).length,
      maxDurationMs: Object.values(syntheticLastDuration).reduce(
        (max, value) => Math.max(max, value),
        0,
      ),
    };
  });

  const syntheticVerdict = $derived.by(() => {
    const maxDurationMs = syntheticRuntimeSummary.maxDurationMs;
    if (syntheticQueue.length > 12 || maxDurationMs > 2_500) return "Queue bound";
    if (syntheticRunning.length > 0 || maxDurationMs > 1_200) return "Saturated";
    return "Healthy";
  });
  const selectedPresetMeta = $derived(
    SYNTHETIC_STRESS_PRESETS.find((preset) => preset.id === selectedPreset) ??
      SYNTHETIC_STRESS_PRESETS[0],
  );
  const presetComparisonRows = $derived.by(() =>
    SYNTHETIC_STRESS_PRESETS.map((preset) => {
      const report = presetReports[preset.id];
      const regression =
        (report?.p95Ms ?? 0) > PRESET_REGRESSION_THRESHOLDS.p95Ms ||
        (report?.maxMs ?? 0) > PRESET_REGRESSION_THRESHOLDS.maxMs ||
        (report?.peakQueue ?? 0) > PRESET_REGRESSION_THRESHOLDS.peakQueue ||
        (report?.saturatedCount ?? 0) > PRESET_REGRESSION_THRESHOLDS.saturatedCount;
      return {
        ...preset,
        report,
        regression,
      };
    }),
  );
  const bestPreset = $derived.by(() => {
    const candidates = presetComparisonRows.filter((row) => row.report?.p95Ms != null);
    if (candidates.length === 0) return null;
    return [...candidates].sort((left, right) => (left.report?.p95Ms ?? 0) - (right.report?.p95Ms ?? 0))[0];
  });
  const worstPreset = $derived.by(() => {
    const candidates = presetComparisonRows.filter((row) => row.report?.p95Ms != null);
    if (candidates.length === 0) return null;
    return [...candidates].sort((left, right) => (right.report?.p95Ms ?? 0) - (left.report?.p95Ms ?? 0))[0];
  });
  const regressionPresetCount = $derived(
    presetComparisonRows.filter((row) => row.regression).length,
  );
  const previousComparisonRows = $derived.by(() =>
    SYNTHETIC_STRESS_PRESETS.map((preset) => {
      const previous = comparisonBaseline?.reports[preset.id];
      const current = presetReports[preset.id];
      const p95Delta =
        current?.p95Ms != null && previous?.p95Ms != null ? current.p95Ms - previous.p95Ms : null;
      const maxDelta =
        current?.maxMs != null && previous?.maxMs != null ? current.maxMs - previous.maxMs : null;
      const queueDelta =
        current != null && previous != null ? current.peakQueue - previous.peakQueue : null;
      return {
        preset,
        previous,
        current,
        p95Delta,
        maxDelta,
        queueDelta,
      };
    }),
  );
  const comparisonDeltaSummary = $derived.by(() => {
    const rows = previousComparisonRows.filter((row) => row.current && row.previous);
    if (rows.length === 0) return null;
    const p95Delta = rows.reduce((sum, row) => sum + (row.p95Delta ?? 0), 0);
    const maxDelta = rows.reduce((sum, row) => sum + (row.maxDelta ?? 0), 0);
    const queueDelta = rows.reduce((sum, row) => sum + (row.queueDelta ?? 0), 0);
    const regressions = rows.filter(
      (row) =>
        (row.current?.p95Ms ?? 0) > (row.previous?.p95Ms ?? 0) ||
        (row.current?.maxMs ?? 0) > (row.previous?.maxMs ?? 0) ||
        (row.current?.peakQueue ?? 0) > (row.previous?.peakQueue ?? 0),
    ).length;
    return {
      samples: rows.length,
      avgP95DeltaMs: p95Delta / rows.length,
      avgMaxDeltaMs: maxDelta / rows.length,
      avgQueueDelta: queueDelta / rows.length,
      regressions,
    };
  });
  const latestSavedComparison = $derived(
    comparisonHistory.length > 0 ? comparisonHistory[comparisonHistory.length - 1] : null,
  );
  const comparisonHistoryRows = $derived.by(() =>
    [...comparisonHistory]
      .slice(-5)
      .reverse()
      .map((snapshot) => {
        const reports = Object.values(snapshot.reports).filter(Boolean);
        const p95Values = reports
          .map((report) => report?.p95Ms)
          .filter((value): value is number => value != null);
        const maxValues = reports
          .map((report) => report?.maxMs)
          .filter((value): value is number => value != null);
        const peakQueue = reports.reduce((peak, report) => Math.max(peak, report?.peakQueue ?? 0), 0);
        const regressions = reports.filter(
          (report) =>
            (report?.p95Ms ?? 0) > PRESET_REGRESSION_THRESHOLDS.p95Ms ||
            (report?.maxMs ?? 0) > PRESET_REGRESSION_THRESHOLDS.maxMs ||
            (report?.peakQueue ?? 0) > PRESET_REGRESSION_THRESHOLDS.peakQueue ||
            (report?.saturatedCount ?? 0) > PRESET_REGRESSION_THRESHOLDS.saturatedCount,
        ).length;
        return {
          savedAt: snapshot.savedAt,
          p95Ms: p95Values.length > 0 ? Math.max(...p95Values) : null,
          maxMs: maxValues.length > 0 ? Math.max(...maxValues) : null,
          peakQueue,
          regressions,
        };
      }),
  );

  function clearSyntheticTelemetry() {
    resetWatcherTelemetry();
    clearWorkloadEvents();
    syntheticQueue = [];
    syntheticRunning = [];
    syntheticLastDuration = {};
    syntheticLastCompletedAt = {};
    syntheticSamples = {};
    currentRunDurations = [];
    currentRunPeakQueue = 0;
    currentRunSaturatedClusters = [];
    presetReports = {};
    lastRunReport = {
      completedAt: null,
      sampleSize: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
      peakQueue: 0,
      saturatedCount: 0,
      preset: undefined,
    };
    refreshTelemetry();
  }

  async function runSyntheticRefreshBatch(selected: AppClusterConfig[], concurrency = 8) {
    const queue = [...selected];
    currentRunDurations = [];
    currentRunPeakQueue = queue.length;
    currentRunSaturatedClusters = [];
    syntheticQueue = queue.map((cluster) => cluster.uuid);
    refreshTelemetry();

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const cluster = queue.shift();
        if (!cluster) return;
        syntheticQueue = syntheticQueue.filter((clusterId) => clusterId !== cluster.uuid);
        syntheticRunning = [...syntheticRunning, cluster.uuid];
        refreshTelemetry();

        const profile = resolveSyntheticRefreshProfile(cluster.uuid, selectedPreset);
        const jitterMs = (profile.seed % 7) * 35;
        const durationMs = profile.durationMs + jitterMs;
        if (durationMs > 1_200) {
          currentRunSaturatedClusters = Array.from(
            new Set([...currentRunSaturatedClusters, cluster.uuid]),
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, durationMs));

        const now = Date.now();
        syntheticRunning = syntheticRunning.filter((clusterId) => clusterId !== cluster.uuid);
        syntheticLastDuration = { ...syntheticLastDuration, [cluster.uuid]: durationMs };
        syntheticLastCompletedAt = { ...syntheticLastCompletedAt, [cluster.uuid]: now };
        currentRunDurations = [...currentRunDurations, durationMs];
        syntheticSamples = {
          ...syntheticSamples,
          [cluster.uuid]: (syntheticSamples[cluster.uuid] ?? 0) + 1,
        };
        clusterHealthChecks.update((checks) => {
          const existing = checks[cluster.uuid];
          if (!existing || "errors" in existing) return checks;
          return {
            ...checks,
            [cluster.uuid]: {
              ...existing,
              timestamp: now,
              updatedAt: now,
            },
          };
        });
        currentRunPeakQueue = Math.max(currentRunPeakQueue, syntheticQueue.length);
        refreshTelemetry();
      }
    });

    await Promise.allSettled(workers);
    const verdict =
      currentRunPeakQueue > 12 || (currentRunDurations.length > 0 && Math.max(...currentRunDurations) > 2_500)
        ? "Queue bound"
        : currentRunSaturatedClusters.length > 0
          ? "Saturated"
          : "Healthy";
    lastRunReport = {
      completedAt: Date.now(),
      sampleSize: currentRunDurations.length,
      p50Ms: percentile(currentRunDurations, 0.5),
      p95Ms: percentile(currentRunDurations, 0.95),
      maxMs: currentRunDurations.length > 0 ? Math.max(...currentRunDurations) : null,
      peakQueue: currentRunPeakQueue,
      saturatedCount: currentRunSaturatedClusters.length,
      preset: selectedPreset,
    };
    presetReports = {
      ...presetReports,
      [selectedPreset]: {
        completedAt: lastRunReport.completedAt,
        p95Ms: lastRunReport.p95Ms,
        maxMs: lastRunReport.maxMs,
        peakQueue: lastRunReport.peakQueue,
        saturatedCount: lastRunReport.saturatedCount,
        verdict,
      },
    };
    refreshTelemetry();
  }

  async function warmAllCards() {
    await runSyntheticRefreshBatch(clusters, 10);
  }

  async function runRefreshWave(size = 12) {
    if (clusters.length === 0) return;
    const start = waveCursor % clusters.length;
    const selected = Array.from({ length: Math.min(size, clusters.length) }, (_, offset) => {
      return clusters[(start + offset) % clusters.length];
    }).filter(Boolean);
    waveCursor = (start + selected.length) % clusters.length;
    await runSyntheticRefreshBatch(selected, 6);
  }

  async function runAutoStressSequence() {
    await runRefreshWave(16);
    await runRefreshWave(16);
    await runRefreshWave(16);
    await warmAllCards();
  }

  async function runAutoStress() {
    if (autoStressRunning) return;
    autoStressRunning = true;
    try {
      await runAutoStressSequence();
    } finally {
      autoStressRunning = false;
      refreshTelemetry();
    }
  }

  async function runPresetComparison() {
    if (autoStressRunning) return;
    autoStressRunning = true;
    const previousPreset = selectedPreset;
    comparisonBaseline = comparisonHistory.length > 0 ? comparisonHistory[comparisonHistory.length - 1] : null;
    try {
      for (const preset of SYNTHETIC_STRESS_PRESETS) {
        selectedPreset = preset.id;
        await runAutoStressSequence();
      }
      writeComparisonHistory(presetReports);
    } finally {
      selectedPreset = previousPreset;
      autoStressRunning = false;
      refreshTelemetry();
    }
  }

  onMount(() => {
    comparisonHistory = readComparisonHistory();
    comparisonBaseline = comparisonHistory.length > 0 ? comparisonHistory[comparisonHistory.length - 1] : null;
    refreshTelemetry();
    const handler = () => refreshTelemetry();
    const interval = window.setInterval(refreshTelemetry, 500);
    window.addEventListener("runtime:telemetry", handler as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("runtime:telemetry", handler as EventListener);
    };
  });
</script>

<section
  data-testid="synthetic-fleet-panel"
  class="rounded-xl border border-sky-300/60 bg-sky-50/80 p-4 shadow-sm dark:border-sky-800/60 dark:bg-sky-950/20"
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h3 class="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Synthetic Fleet Harness
      </h3>
      <p class="text-xs text-slate-700 dark:text-slate-300">
        Stress view for {fleetSize} cards. Use this to tune dashboard rendering, cache reuse, and watcher pressure without real clusters.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button variant="outline" class="h-8 text-xs" onclick={clearSyntheticTelemetry}>
        Clear telemetry
      </Button>
      <Button variant="outline" class="h-8 text-xs" onclick={() => void runRefreshWave()}>
        Refresh wave
      </Button>
      <Button variant="outline" class="h-8 text-xs" onclick={() => void warmAllCards()}>
        Warm all cards
      </Button>
      <Button
        variant="outline"
        class="h-8 text-xs"
        disabled={autoStressRunning}
        onclick={() => void runAutoStress()}
      >
        {autoStressRunning ? "Running stress..." : "Run auto stress"}
      </Button>
      <Button
        variant="outline"
        class="h-8 text-xs"
        disabled={autoStressRunning}
        onclick={runPresetComparison}
      >
        Run preset comparison
      </Button>
    </div>
  </div>

  <div class="mt-3 rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="text-xs text-muted-foreground">Stress preset</div>
        <div class="mt-1 font-semibold">{selectedPresetMeta.label}</div>
        <div class="text-xs text-muted-foreground">{selectedPresetMeta.description}</div>
      </div>
      <label class="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Preset</span>
        <select
          class="h-8 rounded-md border border-sky-300/60 bg-background px-2 text-sm text-foreground"
          bind:value={selectedPreset}
          aria-label="Synthetic stress preset"
        >
          {#each SYNTHETIC_STRESS_PRESETS as preset}
            <option value={preset.id}>{preset.label}</option>
          {/each}
        </select>
      </label>
    </div>
  </div>

  <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <div class="rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Cards</div>
      <div class="mt-1 font-semibold">{fleetStats.total}</div>
      <div class="text-xs text-muted-foreground">
        {fleetStats.hydrated} hydrated / {fleetStats.pending} pending
      </div>
    </div>
    <div class="rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Health mix</div>
      <div class="mt-1 font-semibold">
        {fleetStats.healthy} ok / {fleetStats.warning} warn / {fleetStats.critical} critical
      </div>
      <div class="text-xs text-muted-foreground">{fleetStats.offline} offline</div>
    </div>
    <div class="rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Watcher pressure</div>
      <div class="mt-1 font-semibold">
        {watcherRuntimeSummary.activeUpdates} active / {watcherRuntimeSummary.pendingUpdates} queued
      </div>
      <div class="text-xs text-muted-foreground">
        limit {watcherRuntimeSummary.maxConcurrentUpdates} / watchers {watcherRuntimeSummary.registeredWatchers}
      </div>
    </div>
    <div class="rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Perf</div>
      <div class="mt-1 font-semibold">
        overview p95 {formatDuration(overviewP95)} / workloads p95 {formatDuration(workloadsP95)}
      </div>
      <div class="text-xs text-muted-foreground">
        {workloadEvents.length} workload events / {perfAlertCount} perf alerts
      </div>
    </div>
    <div class="rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
      <div class="text-xs text-muted-foreground">Synthetic stress</div>
      <div class="mt-1 font-semibold">
        {syntheticRuntimeSummary.active} active / {syntheticRuntimeSummary.queued} queued
      </div>
      <div class="text-xs text-muted-foreground">
        {syntheticVerdict} · max {formatDuration(syntheticRuntimeSummary.maxDurationMs || null)}
      </div>
    </div>
  </div>

  <div class="mt-4 rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Last stress run</div>
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <div class="text-xs text-muted-foreground">Preset</div>
        <div class="mt-1 font-semibold">
          {#if lastRunReport.preset}
            {SYNTHETIC_STRESS_PRESETS.find((preset) => preset.id === lastRunReport.preset)?.label ??
              lastRunReport.preset}
          {:else}
            n/a
          {/if}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Completed</div>
        <div class="mt-1 font-semibold">{formatAt(lastRunReport.completedAt)}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">p50 / p95 / max</div>
        <div class="mt-1 font-semibold">
          {formatDuration(lastRunReport.p50Ms)} / {formatDuration(lastRunReport.p95Ms)} / {formatDuration(lastRunReport.maxMs)}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Samples / peak queue</div>
        <div class="mt-1 font-semibold">{lastRunReport.sampleSize} / {lastRunReport.peakQueue}</div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Saturated clusters</div>
        <div class="mt-1 font-semibold">{lastRunReport.saturatedCount}</div>
      </div>
    </div>
  </div>

  <div class="mt-4 rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Preset verdicts</div>
    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <div class="text-xs text-muted-foreground">Best preset</div>
        <div class="mt-1 font-semibold">{bestPreset?.label ?? "n/a"}</div>
        <div class="text-xs text-muted-foreground">
          p95 {formatDuration(bestPreset?.report?.p95Ms ?? null)}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Worst preset</div>
        <div class="mt-1 font-semibold">{worstPreset?.label ?? "n/a"}</div>
        <div class="text-xs text-muted-foreground">
          p95 {formatDuration(worstPreset?.report?.p95Ms ?? null)}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Regression presets</div>
        <div class="mt-1 font-semibold">{regressionPresetCount}</div>
        <div class="text-xs text-muted-foreground">
          p95>{PRESET_REGRESSION_THRESHOLDS.p95Ms}ms or queue>{PRESET_REGRESSION_THRESHOLDS.peakQueue}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">Thresholds</div>
        <div class="mt-1 font-semibold">
          max {PRESET_REGRESSION_THRESHOLDS.maxMs}ms / sat {PRESET_REGRESSION_THRESHOLDS.saturatedCount}
        </div>
        <div class="text-xs text-muted-foreground">Synthetic-only regression guard</div>
      </div>
    </div>
  </div>

  <div class="mt-4 rounded-md border border-sky-300/50 bg-background/90 p-3 text-sm">
    <div class="mb-2 flex items-center justify-between gap-3">
      <div class="text-xs font-semibold text-muted-foreground">Comparison history</div>
      <Button variant="outline" class="h-7 text-xs" onclick={clearComparisonHistory}>
        Clear history
      </Button>
    </div>
    {#if comparisonHistory.length === 0}
      <div class="text-sm text-muted-foreground">
        Run preset comparison once to save a baseline and show delta versus the previous run.
      </div>
    {:else if !comparisonDeltaSummary}
      <div class="text-sm text-muted-foreground">
        Latest comparison saved at {formatAt(latestSavedComparison?.savedAt ?? null)}. Run preset comparison again to compute deltas.
      </div>
    {:else}
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <div class="text-xs text-muted-foreground">Previous baseline</div>
          <div class="mt-1 font-semibold">{formatAt(comparisonBaseline?.savedAt ?? null)}</div>
          <div class="text-xs text-muted-foreground">{comparisonDeltaSummary.samples} presets compared</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground">Avg p95 delta</div>
          <div class="mt-1 font-semibold">{formatDelta(comparisonDeltaSummary.avgP95DeltaMs)}</div>
          <div class="text-xs text-muted-foreground">Negative is better</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground">Avg max / queue delta</div>
          <div class="mt-1 font-semibold">
            {formatDelta(comparisonDeltaSummary.avgMaxDeltaMs)} / {Math.round(comparisonDeltaSummary.avgQueueDelta)}
          </div>
          <div class="text-xs text-muted-foreground">Peak queue delta</div>
        </div>
        <div>
          <div class="text-xs text-muted-foreground">Regression presets</div>
          <div class="mt-1 font-semibold">{comparisonDeltaSummary.regressions}</div>
          <div class="text-xs text-muted-foreground">Compared to previous baseline</div>
        </div>
      </div>
    {/if}
  </div>

  <div class="mt-4 overflow-auto rounded-md border border-sky-300/50 bg-background/90 p-3">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Recent comparison runs</div>
    {#if comparisonHistoryRows.length === 0}
      <div class="text-sm text-muted-foreground">
        No saved comparison runs yet.
      </div>
    {:else}
      <table class="min-w-full text-left text-sm">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="pr-3">Saved</th>
            <th class="pr-3">Worst P95</th>
            <th class="pr-3">Worst max</th>
            <th class="pr-3">Peak queue</th>
            <th class="pr-3">Regressions</th>
          </tr>
        </thead>
        <tbody>
          {#each comparisonHistoryRows as row (row.savedAt)}
            <tr class="border-t border-border/40">
              <td class="py-2 pr-3">{formatAt(row.savedAt)}</td>
              <td class="pr-3">{formatDuration(row.p95Ms)}</td>
              <td class="pr-3">{formatDuration(row.maxMs)}</td>
              <td class="pr-3">{row.peakQueue}</td>
              <td class="pr-3">{row.regressions}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="mt-4 overflow-auto rounded-md border border-sky-300/50 bg-background/90 p-3">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Preset comparison</div>
    {#if Object.keys(presetReports).length === 0}
      <div class="text-sm text-muted-foreground">
        Run one or more presets to compare p95, max duration, queue peak, and verdict.
      </div>
    {:else}
      <table class="min-w-full text-left text-sm">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="pr-3">Preset</th>
            <th class="pr-3">P95</th>
            <th class="pr-3">Max</th>
            <th class="pr-3">Peak queue</th>
            <th class="pr-3">Saturated</th>
            <th class="pr-3">Verdict</th>
            <th class="pr-3">Regression</th>
            <th class="pr-3">Delta vs prev</th>
          </tr>
        </thead>
        <tbody>
          {#each presetComparisonRows as preset (preset.id)}
            <tr class="border-t border-border/40">
              <td class="py-2 pr-3">{preset.label}</td>
              <td class="pr-3">{formatDuration(preset.report?.p95Ms ?? null)}</td>
              <td class="pr-3">{formatDuration(preset.report?.maxMs ?? null)}</td>
              <td class="pr-3">{preset.report?.peakQueue ?? "n/a"}</td>
              <td class="pr-3">{preset.report?.saturatedCount ?? "n/a"}</td>
              <td class="pr-3 text-xs text-muted-foreground">
                {preset.report?.verdict ?? "n/a"}
              </td>
              <td class="pr-3 text-xs font-medium {preset.regression ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}">
                {preset.regression ? "Yes" : "No"}
              </td>
              <td class="pr-3 text-xs text-muted-foreground">
                {#if previousComparisonRows.find((row) => row.preset.id === preset.id)?.p95Delta != null}
                  {formatDelta(previousComparisonRows.find((row) => row.preset.id === preset.id)?.p95Delta ?? null)}
                {:else}
                  n/a
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="mt-4 overflow-auto rounded-md border border-sky-300/50 bg-background/90 p-3">
    <div class="mb-2 text-xs font-semibold text-muted-foreground">Top slow cards</div>
    {#if topSlowCards.length === 0}
      <div class="text-sm text-muted-foreground">
        No synthetic card refresh telemetry yet. Refresh a few cards or let cron collect samples.
      </div>
    {:else}
      <table class="min-w-full text-left text-sm">
        <thead class="text-xs text-muted-foreground">
          <tr>
            <th class="pr-3">Cluster</th>
            <th class="pr-3">Latest</th>
            <th class="pr-3">P95</th>
            <th class="pr-3">Samples</th>
            <th class="pr-3">State</th>
            <th class="pr-3">Last event</th>
          </tr>
        </thead>
        <tbody>
          {#each topSlowCards as row (row.clusterId)}
            <tr class="border-t border-border/40">
              <td class="py-2 pr-3 text-xs text-slate-700 dark:text-slate-200">{row.clusterId}</td>
              <td class="pr-3">{formatDuration(row.latestDurationMs)}</td>
              <td class="pr-3 font-medium">{formatDuration(row.p95DurationMs)}</td>
              <td class="pr-3">{row.samples}</td>
              <td class="pr-3 text-xs text-muted-foreground">
                {#if row.loading}
                  running
                {:else if row.pending}
                  queued
                {:else}
                  idle
                {/if}
              </td>
              <td class="pr-3 text-xs text-muted-foreground">{formatAt(row.lastAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>
