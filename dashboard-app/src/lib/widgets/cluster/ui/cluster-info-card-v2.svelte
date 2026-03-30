<script lang="ts">
  import { goto } from "$app/navigation";
  import {
    selectClusterHealthCheck,
    clusterStates,
    type ClusterHealthChecks,
  } from "$features/check-health/";
  import { getColorForClusterCard, countTotalPodRestarts } from "$features/check-health";
  import { buildClusterHealthScore } from "$features/check-health/model/cluster-health-score";
  import { buildClusterScore } from "$features/check-health/model/cluster-score";
  import { selectClusterDrift } from "$features/fleet-drift";
  import * as Card from "$shared/ui/card";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import { Gauge } from "$shared/ui/icons";
  import {
    Refresh,
    SquareChevronRight,
    Heart,
    BarChart3,
    Timer,
    Shield,
    ArrowUpCircle,
  } from "$shared/ui/icons";
  import type { AppClusterConfig } from "$entities/config/";
  import {
    startGlobalWatcher,
    stopGlobalWatcher,
    updateClusterHealthChecks,
    loadClusterRefreshInterval,
    saveClusterRefreshInterval,
    loadClusterLinterEnabled,
    saveClusterLinterEnabled,
    isClusterHealthCheckHydrated,
  } from "$features/check-health/";
  import {
    dashboardDataProfile,
    shouldAutoRunDiagnostics,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import { getClusterPlatformLabel } from "$shared/ui/cluster-platform";
  import {
    humanizeClusterError,
    isConnectionError,
  } from "$widgets/datalists/ui/model/overview-diagnostics";
  import { onMount, onDestroy, type Component } from "svelte";
  import { page } from "$app/stores";
  import { stopAllBackgroundPollers } from "$shared/lib/background-pollers";
  import { markClusterRefreshHintSeen } from "$features/cluster-manager";
  import { globalLinterEnabled } from "$features/check-health/model/linter-preferences";
  import { buildPrimaryAlert } from "$widgets/datalists/ui/model/overview-diagnostics";
  import DriftBadge from "./drift-badge.svelte";

  interface Props {
    cluster: AppClusterConfig;
    autoRefreshActive?: boolean;
    syntheticMode?: boolean;
    layout?: "vertical" | "horizontal";
  }

  const {
    cluster,
    autoRefreshActive = true,
    syntheticMode = false,
    layout = "vertical",
  }: Props = $props();
  const isHorizontal = $derived(layout === "horizontal");

  const clusterUuid = cluster.uuid;
  const clusterCheck$ = selectClusterHealthCheck(clusterUuid);
  let lastCheck = $derived($globalLinterEnabled ? $clusterCheck$ || null : null);
  const scoredChecks = $derived.by<ClusterHealthChecks | null>(() => {
    if (!lastCheck || "errors" in lastCheck) return null;
    return lastCheck;
  });
  const checkState = $derived($clusterStates[cluster.uuid] || { loading: false, error: null });
  const isClustersListRoute = $derived($page.url.pathname === "/dashboard");
  const awaitingInitialRefresh = $derived(Boolean(cluster.needsInitialRefreshHint) && !lastCheck);
  const clusterCardColor = $derived(getColorForClusterCard(lastCheck));
  const displayClusterCardColor = $derived.by(() => {
    if (!effectiveLinter)
      return {
        color: "bg-slate-600",
        text: "Paused",
        tooltip: "Health monitoring is paused. Enable the linter toggle to start diagnostics.",
      };
    if (awaitingInitialRefresh)
      return {
        color: "bg-slate-500",
        text: "Pending",
        tooltip: "Waiting for initial health check. Click the refresh button to start.",
      };
    if (checkState.error && isConnectionError(checkState.error))
      return {
        color: "bg-slate-600",
        text: "Offline",
        tooltip: "Cannot connect to the cluster API server. Check if the cluster is running.",
      };
    const base = clusterCardColor;
    const tooltip =
      base.text === "Ok"
        ? "All health checks passed. Cluster is healthy."
        : base.text === "Warning"
          ? "Some health checks have warnings. Review the diagnostics for details."
          : base.text === "Critical"
            ? "Critical issues detected. Immediate attention recommended."
            : "Cluster status could not be determined. Run a health check to update.";
    return { ...base, tooltip };
  });
  const platformLabel = $derived(getClusterPlatformLabel(cluster.name));
  const isRefreshLoading = $derived(checkState.loading);
  const showInitialRefreshHint = $derived(
    Boolean(cluster.needsInitialRefreshHint) && !isRefreshLoading && isClustersListRoute,
  );
  const autoDiagnosticsEnabled = $derived(shouldAutoRunDiagnostics($dashboardDataProfile));

  const healthScore = $derived(buildClusterHealthScore(scoredChecks));
  const clusterScore = $derived(buildClusterScore(scoredChecks));

  const primaryAlert = $derived.by(() => {
    if (cluster.needsInitialRefreshHint) {
      return { severity: "info" as const, title: "Initial refresh required" };
    }
    return buildPrimaryAlert(lastCheck);
  });

  // ── Goal blocks ────────────────────────────────────────────────
  type GoalStatus = "ok" | "warning" | "critical" | "unknown";
  type GoalBlock = {
    id: string;
    icon: Component;
    label: string;
    status: GoalStatus;
    metrics: string;
    detail: string;
    route: string;
  };

  function worstStatus(statuses: (string | undefined | null)[]): GoalStatus {
    const known = statuses.filter((s): s is string => s != null && s !== "unknown");
    if (known.length === 0) return "unknown";
    if (known.some((s) => s === "critical")) return "critical";
    if (known.some((s) => s === "warning")) return "warning";
    return "ok";
  }

  const goalBlocks = $derived.by<GoalBlock[]>(() => {
    const empty: GoalBlock[] = [
      {
        id: "health",
        icon: Heart,
        label: "Health",
        status: "unknown",
        metrics: "-",
        detail: "No data",
        route: "overview",
      },
      {
        id: "capacity",
        icon: BarChart3,
        label: "Capacity",
        status: "unknown",
        metrics: "-",
        detail: "No data",
        route: "pods",
      },
      {
        id: "ha",
        icon: Timer,
        label: "HA",
        status: "unknown",
        metrics: "-",
        detail: "No data",
        route: "overview",
      },
      {
        id: "security",
        icon: Shield,
        label: "Security",
        status: "unknown",
        metrics: "-",
        detail: "No data",
        route: "compliancehub",
      },
      {
        id: "upgrades",
        icon: ArrowUpCircle,
        label: "Upgrades",
        status: "unknown",
        metrics: "-",
        detail: "No data",
        route: "deprecationscan",
      },
    ];
    if (!lastCheck || "errors" in lastCheck) return empty;

    const lc = lastCheck as ClusterHealthChecks & Record<string, unknown>;
    const nodesReady = lc.nodes?.summary?.count.ready ?? 0;
    const nodesTotal = lc.nodes?.summary?.count.total ?? 0;
    const restarts = countTotalPodRestarts(lc.podRestarts);
    const crashLoops = lc.podIssues?.crashLoopCount ?? 0;

    const healthSt = worstStatus([
      lc.apiServerHealth?.status,
      lc.etcdHealth?.status,
      lc.podIssues?.status,
      lc.warningEvents?.status,
    ]);
    const healthMetrics = nodesTotal > 0 ? `${nodesReady}/${nodesTotal} nodes` : `${lc.pods} pods`;
    const healthDetail =
      crashLoops > 0
        ? `${crashLoops} crash · ${restarts} restarts`
        : restarts > 0
          ? `${restarts} restarts`
          : "All healthy";

    const capSt = worstStatus([
      lc.resourcesHygiene?.status,
      lc.hpaStatus?.status,
      lc.podQos?.status,
    ]);
    const capMetrics = `${lc.pods ?? 0} pods · ${lc.deployments ?? 0} deploy`;
    const capDetail = `${lc.statefulSets ?? 0} sts · ${lc.daemonSets ?? 0} ds · ${lc.jobs ?? 0} jobs`;

    const haSt = worstStatus([
      lc.pdbStatus?.status,
      lc.topologyHa?.status,
      lc.probesHealth?.status,
    ]);
    const pdbOk = lc.pdbStatus?.summary?.ok ?? 0;
    const pdbTotal = lc.pdbStatus?.summary?.total ?? 0;
    const haMetrics = pdbTotal > 0 ? `PDB ${pdbOk}/${pdbTotal}` : "No PDB";
    const probesOk = lc.probesHealth?.summary?.ok ?? 0;
    const probesTotal = lc.probesHealth?.summary?.total ?? 0;
    const haDetail = probesTotal > 0 ? `Probes ${probesOk}/${probesTotal}` : "Probes n/a";

    const secSt = worstStatus([
      lc.podSecurity?.status,
      lc.networkIsolation?.status,
      lc.secretsHygiene?.status,
      lc.securityHardening?.status,
    ]);
    const netOk = lc.networkIsolation?.summary?.ok ?? 0;
    const netTotal = lc.networkIsolation?.summary?.total ?? 0;
    const secMetrics = netTotal > 0 ? `NetPol ${netOk}/${netTotal}` : "NetPol n/a";
    const secDetail = lc.podSecurity?.status === "ok" ? "PSA enforced" : "PSA gaps";

    const upgSt = worstStatus([
      lc.certificatesHealth?.status,
      lc.apfHealth?.status,
      lc.admissionWebhooks?.status,
    ]);
    const upgMetrics = lc.certificatesHealth?.status === "ok" ? "Certs OK" : "Certs check";
    const upgDetail = lc.apfHealth?.status === "ok" ? "APF OK" : "APF check";

    return [
      {
        id: "health",
        icon: Heart,
        label: "Health",
        status: healthSt,
        metrics: healthMetrics,
        detail: healthDetail,
        route: "overview",
      },
      {
        id: "capacity",
        icon: BarChart3,
        label: "Capacity",
        status: capSt,
        metrics: capMetrics,
        detail: capDetail,
        route: "pods",
      },
      {
        id: "ha",
        icon: Timer,
        label: "HA",
        status: haSt,
        metrics: haMetrics,
        detail: haDetail,
        route: "overview",
      },
      {
        id: "security",
        icon: Shield,
        label: "Security",
        status: secSt,
        metrics: secMetrics,
        detail: secDetail,
        route: "compliancehub",
      },
      {
        id: "upgrades",
        icon: ArrowUpCircle,
        label: "Upgrades",
        status: upgSt,
        metrics: upgMetrics,
        detail: upgDetail,
        route: "deprecationscan",
      },
    ];
  });

  const statusColors: Record<GoalStatus, string> = {
    ok: "bg-emerald-600",
    warning: "bg-amber-600",
    critical: "bg-rose-600",
    unknown: "bg-slate-500",
  };

  const iconColors: Record<GoalStatus, string> = {
    ok: "text-emerald-500",
    warning: "text-amber-500",
    critical: "text-rose-500",
    unknown: "text-slate-400",
  };

  // ── Navigation ─────────────────────────────────────────────────
  let refreshInterval = $state("5");
  let linterEnabled = $state(true);
  const globalLinter = $derived($globalLinterEnabled);
  const effectiveLinter = $derived(globalLinter && linterEnabled);
  let healthCheckHydrated = $state(false);
  const refreshIntervalMs = $derived(Number(refreshInterval) * 60_000);

  function goToCluster() {
    if (!cluster.name) return;
    stopAllBackgroundPollers();
    goto(`/dashboard/clusters/${encodeURIComponent(cluster.uuid)}?workload=overview`);
  }

  function goToWorkload(workload: string) {
    if (!cluster.name) return;
    stopAllBackgroundPollers();
    goto(`/dashboard/clusters/${encodeURIComponent(cluster.uuid)}?workload=${workload}`);
  }

  async function refreshData() {
    if (isRefreshLoading) return;
    try {
      const init = cluster.needsInitialRefreshHint;
      await updateClusterHealthChecks(cluster.uuid, { force: true });
      if (cluster.status === "error") cluster.status = "ok";
      if (init) {
        cluster.needsInitialRefreshHint = false;
        void markClusterRefreshHintSeen(cluster.uuid);
      }
      if (effectiveLinter) {
        void updateClusterHealthChecks(cluster.uuid, {
          force: true,
          diagnostics: true,
          diagnosticsScope: "config",
        }).then(() =>
          updateClusterHealthChecks(cluster.uuid, {
            force: true,
            diagnostics: true,
            diagnosticsScope: "health",
          }),
        );
      }
    } catch {
      /* checkState handles */
    }
  }

  onMount(async () => {
    try {
      if (!isClusterHealthCheckHydrated(cluster.uuid)) {
        const { getLastHealthCheck } = await import("$features/check-health/");
        await getLastHealthCheck(cluster.uuid);
      }
      const si = await loadClusterRefreshInterval(cluster.uuid);
      if (si && new Set([1, 5, 10]).has(si)) refreshInterval = `${si}`;
      linterEnabled = await loadClusterLinterEnabled(cluster.uuid);
    } catch {
      /* */
    } finally {
      healthCheckHydrated = true;
    }
  });

  $effect(() => {
    if (!cluster.uuid || !healthCheckHydrated || !isClustersListRoute) return;
    if (cluster.needsInitialRefreshHint || !autoRefreshActive || !autoDiagnosticsEnabled) {
      stopGlobalWatcher(cluster.uuid);
      return;
    }
    const imm = !lastCheck || ("errors" in lastCheck && Boolean(lastCheck.errors));
    startGlobalWatcher(cluster.uuid, refreshIntervalMs, imm);
  });

  function toggleLinter() {
    linterEnabled = !linterEnabled;
    void saveClusterLinterEnabled(cluster.uuid, linterEnabled);
  }

  // Auto-load config+health diagnostics after first successful refresh
  // so Cluster Score and Health Score populate without manual button clicks.
  // Uses scoredChecks (filters out error records) so a transient error
  // after a successful refresh does not permanently block diagnostics.
  let diagnosticsAutoQueued = false;
  $effect(() => {
    if (diagnosticsAutoQueued) return;
    if (!effectiveLinter) return;
    if (!scoredChecks) return;
    diagnosticsAutoQueued = true;
    // Queue config then health diagnostics sequentially
    void updateClusterHealthChecks(cluster.uuid, {
      force: true,
      diagnostics: true,
      diagnosticsScope: "config",
    })
      .then(() =>
        updateClusterHealthChecks(cluster.uuid, {
          force: true,
          diagnostics: true,
          diagnosticsScope: "health",
        }),
      )
      .catch(() => {
        /* best effort */
      });
  });

  onDestroy(() => stopGlobalWatcher(cluster.uuid));
</script>

{#if cluster.name}
  <Card.Root
    data-testid="cluster-card"
    class="bg-white/70 backdrop-blur-sm border border-slate-200/50 dark:bg-slate-700 shadow-md overflow-hidden"
  >
    <!-- Header -->
    <Card.Title
      class="flex items-center text-white px-4 py-3 cursor-pointer {displayClusterCardColor?.color ??
        'bg-slate-600'} rounded-t-xl transition-colors duration-500"
    >
      <div class="relative flex">
        <Button
          class={`hover:bg-transparent transition ${showInitialRefreshHint ? "animate-pulse rounded-full ring-2 ring-white/80 ring-offset-2 ring-offset-transparent" : ""} ${isRefreshLoading ? "cursor-not-allowed opacity-70" : ""}`}
          variant="ghost"
          onclick={refreshData}
          disabled={isRefreshLoading}
        >
          <Refresh
            class={isRefreshLoading
              ? "animate-spin"
              : showInitialRefreshHint
                ? "animate-bounce"
                : ""}
          />
        </Button>
        {#if showInitialRefreshHint}
          <span
            class="pointer-events-none absolute -right-16 top-1/2 -translate-y-1/2 rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900 shadow-sm"
          >
            refresh me
          </span>
        {/if}
      </div>
      <button
        type="button"
        class="truncate font-semibold bg-transparent border-0 text-white text-left cursor-pointer"
        title={cluster.name}
        onclick={goToCluster}
      >
        {cluster.name}
      </button>
      <Button class="hover:bg-transparent ml-auto" variant="ghost" onclick={goToCluster}>
        <SquareChevronRight class="w-4 h-4" />
      </Button>
    </Card.Title>

    <!-- Status bar -->
    <div class="px-4 py-2.5 flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 flex-wrap">
        <Badge
          class="text-white {displayClusterCardColor?.color ??
            'bg-slate-500'} text-[11px] h-5 px-1.5 cursor-help"
          title={displayClusterCardColor?.tooltip ?? ""}
        >
          {displayClusterCardColor?.text.toUpperCase() ?? "UNKNOWN"}
        </Badge>
        <DriftBadge clusterId={cluster.uuid} />
        <span class="text-xs text-muted-foreground">{platformLabel}</span>
      </div>
      <div class="flex items-center gap-2">
        {#if effectiveLinter}
          {#if healthScore.score != null}
            <span
              class="text-xs font-bold tabular-nums {healthScore.score >= 85
                ? 'text-emerald-500'
                : healthScore.score >= 65
                  ? 'text-amber-500'
                  : 'text-rose-500'}"
              title="Health Score: {healthScore.score}/100">{healthScore.score}</span
            >
          {:else}
            <span class="text-xs text-muted-foreground" title="Health Score">-</span>
          {/if}
          {#if clusterScore.score != null}
            <span
              class="text-xs font-bold tabular-nums {clusterScore.score >= 85
                ? 'text-emerald-500'
                : clusterScore.score >= 60
                  ? 'text-amber-500'
                  : 'text-rose-500'}"
              title="Cluster Score: {clusterScore.score}/100{clusterScore.topRisks.length > 0
                ? `\nTop risks:\n${clusterScore.topRisks.map((r) => `- ${r.title}`).join('\n')}`
                : ''}">{clusterScore.score}</span
            >
          {:else}
            <span class="text-xs text-muted-foreground" title="Cluster Score">-</span>
          {/if}
        {/if}
        <button
          class="flex items-center gap-0.5 rounded border px-1 h-5 text-[10px] font-semibold transition {effectiveLinter
            ? 'border-emerald-600 text-emerald-400'
            : 'border-slate-600 text-slate-500'}"
          onclick={toggleLinter}
          disabled={!globalLinter}
          title={!globalLinter
            ? "Linter disabled globally"
            : linterEnabled
              ? "Linter ON"
              : "Linter OFF"}
        >
          <Gauge class="w-3 h-3" />
        </button>
        <select
          class="h-6 appearance-auto rounded border border-slate-500 bg-slate-700 px-1 text-[10px] font-semibold text-white"
          bind:value={refreshInterval}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            refreshInterval = v;
            void saveClusterRefreshInterval(cluster.uuid, Number(v));
          }}
          title="Auto-refresh interval for health diagnostics"
        >
          {#each [{ l: "1m", v: "1" }, { l: "5m", v: "5" }, { l: "10m", v: "10" }] as o (o.v)}
            <option value={o.v}>{o.l}</option>
          {/each}
        </select>
      </div>
    </div>

    <!-- Connection error (from checkState, may appear before primaryAlert updates) -->
    {#if checkState.error && isConnectionError(checkState.error) && primaryAlert.severity === "ok"}
      {@const friendly = humanizeClusterError(checkState.error)}
      <button
        type="button"
        class="mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-lg border px-3 py-1.5 text-left text-xs shadow-sm transition hover:opacity-80
          border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800/40"
        onclick={goToCluster}
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium truncate">{friendly.title}</span>
          <Badge class="text-white text-[9px] h-4 px-1 shrink-0 bg-rose-600">Crit</Badge>
        </div>
      </button>
      <!-- Primary Alert -->
    {:else if primaryAlert.severity !== "ok"}
      <button
        type="button"
        class="mx-3 mb-2 block w-[calc(100%-1.5rem)] rounded-lg border px-3 py-1.5 text-left text-xs shadow-sm transition hover:opacity-80
          {primaryAlert.severity === 'critical'
          ? 'border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800/40'
          : primaryAlert.severity === 'warning'
            ? 'border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/40'
            : 'border-sky-300/60 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800/40'}"
        onclick={goToCluster}
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium truncate">{primaryAlert.title}</span>
          <Badge
            class={`text-white text-[9px] h-4 px-1 shrink-0 ${primaryAlert.severity === "critical" ? "bg-rose-600" : primaryAlert.severity === "warning" ? "bg-amber-600" : "bg-sky-700"}`}
          >
            {primaryAlert.severity === "critical"
              ? "Crit"
              : primaryAlert.severity === "warning"
                ? "Warn"
                : "Info"}
          </Badge>
        </div>
      </button>
    {/if}

    <!-- 5 Goal Blocks -->
    {#if effectiveLinter}
      <div class={isHorizontal ? "px-3 pb-2 grid grid-cols-5 gap-1" : "px-3 pb-3 space-y-0.5"}>
        {#each goalBlocks as block (block.id)}
          <button
            type="button"
            class={isHorizontal
              ? "flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-center transition hover:bg-slate-100 dark:hover:bg-slate-600/40 group"
              : "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-slate-100 dark:hover:bg-slate-600/40 group"}
            onclick={() => goToWorkload(block.route)}
            title="{block.label}: {block.metrics} - {block.detail}"
          >
            {#if isHorizontal}
              {@const BlockIcon = block.icon}
              <BlockIcon class="w-5 h-5 {iconColors[block.status]}" />
              <div class="text-[12px] font-semibold leading-tight">{block.label}</div>
              <Badge
                class="text-white {statusColors[
                  block.status
                ]} text-[10px] h-5 px-1.5 whitespace-nowrap"
              >
                {block.status === "ok"
                  ? "OK"
                  : block.status === "warning"
                    ? "Warn"
                    : block.status === "critical"
                      ? "Crit"
                      : "-"}
              </Badge>
              <div class="text-[11px] text-muted-foreground">{block.metrics}</div>
              <div class="text-[10px] text-muted-foreground group-hover:text-foreground transition">
                {block.detail}
              </div>
            {:else}
              {@const BlockIcon = block.icon}
              <BlockIcon class="w-5 h-5 shrink-0 {iconColors[block.status]}" />
              <div class="flex-1 min-w-0">
                <div class="text-[13px] font-semibold leading-tight">{block.label}</div>
                <div class="text-[11px] text-muted-foreground truncate">{block.metrics}</div>
              </div>
              <div class="text-right shrink-0">
                <Badge
                  class="text-white {statusColors[
                    block.status
                  ]} text-[10px] h-5 px-1.5 whitespace-nowrap"
                >
                  {block.status === "ok"
                    ? "OK"
                    : block.status === "warning"
                      ? "Warn"
                      : block.status === "critical"
                        ? "Crit"
                        : "-"}
                </Badge>
                <div
                  class="text-[10px] text-muted-foreground mt-0.5 group-hover:text-foreground transition"
                >
                  {block.detail}
                </div>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Workload counts bar (clickable) -->
    {#if lastCheck && !("errors" in lastCheck)}
      <div
        class="px-4 py-2 border-t border-slate-200/50 dark:border-slate-600/40 flex items-center {isHorizontal
          ? 'gap-4'
          : 'justify-between'} text-[11px] text-muted-foreground"
      >
        <button
          type="button"
          class="hover:text-foreground transition cursor-pointer"
          onclick={() => goToWorkload("overview")}
          title="Namespaces">{lastCheck.namespaces.length} ns</button
        >
        <button
          type="button"
          class="hover:text-foreground transition cursor-pointer"
          onclick={() => goToWorkload("pods")}
          title="Pods">{lastCheck.pods} pods</button
        >
        <button
          type="button"
          class="hover:text-foreground transition cursor-pointer"
          onclick={() => goToWorkload("deployments")}
          title="Deployments">{lastCheck.deployments} deploy</button
        >
        <button
          type="button"
          class="hover:text-foreground transition cursor-pointer"
          onclick={() => goToWorkload("statefulsets")}
          title="StatefulSets">{lastCheck.statefulSets} sts</button
        >
        <button
          type="button"
          class="hover:text-foreground transition cursor-pointer"
          onclick={() => goToWorkload("daemonsets")}
          title="DaemonSets">{lastCheck.daemonSets} ds</button
        >
        <button
          type="button"
          class="hover:text-foreground transition cursor-pointer"
          onclick={() => goToWorkload("nodesstatus")}
          title="Nodes">{lastCheck.nodes?.summary?.count.total ?? 0} nodes</button
        >
      </div>
    {/if}
  </Card.Root>
{/if}
