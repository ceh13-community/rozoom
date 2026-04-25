<script lang="ts">
  import { clusterStates, clusterHealthChecks } from "$features/check-health/";
  import { clustersList } from "$features/cluster-manager";
  import {
    buildFleetSummary,
    fleetSummaryHeadline,
    type FleetStatusBucket,
  } from "$features/cluster-manager/model/fleet-summary";
  import { detectClusterProvider } from "$shared/lib/provider-detection";
  import { inferEnv } from "$features/cluster-manager/model/infer-env";

  interface Props {
    onFilter?: (bucket: FleetStatusBucket | null) => void;
    activeFilter?: FleetStatusBucket | null;
  }

  const { onFilter, activeFilter = null }: Props = $props();

  const summary = $derived(
    buildFleetSummary({
      clusters: $clustersList,
      states: $clusterStates,
      health: $clusterHealthChecks,
      envFor: (c) => c.env || inferEnv(c.name) || undefined,
      providerFor: (c) => c.provider || detectClusterProvider({ clusterName: c.name }).provider,
    }),
  );

  const headline = $derived(fleetSummaryHeadline(summary));

  function chipClass(active: boolean, tone: "ok" | "warn" | "danger" | "muted"): string {
    if (active) {
      switch (tone) {
        case "ok":
          return "bg-emerald-500 text-white border-emerald-500";
        case "warn":
          return "bg-amber-500 text-white border-amber-500";
        case "danger":
          return "bg-rose-500 text-white border-rose-500";
        case "muted":
          return "bg-slate-500 text-white border-slate-500";
      }
    }
    switch (tone) {
      case "ok":
        return "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10";
      case "warn":
        return "border-amber-500/40 text-amber-400 hover:bg-amber-500/10";
      case "danger":
        return "border-rose-500/40 text-rose-400 hover:bg-rose-500/10";
      case "muted":
        return "border-slate-500/40 text-slate-400 hover:bg-slate-500/10";
    }
  }

  function toggle(bucket: FleetStatusBucket) {
    onFilter?.(activeFilter === bucket ? null : bucket);
  }
</script>

<div
  class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/60 p-4 shadow-sm"
>
  <div class="flex items-center justify-between gap-3 flex-wrap">
    <div class="min-w-0">
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100">Fleet Health</h2>
      <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate" title={headline}>
        {headline}
      </p>
    </div>
    <div class="flex flex-wrap gap-1.5">
      <button
        type="button"
        onclick={() => toggle("online")}
        class="text-[11px] h-7 px-2 rounded-full border cursor-pointer transition {chipClass(
          activeFilter === 'online',
          'ok',
        )}"
        title="Clusters reachable with all checks green"
      >
        <span class="font-bold tabular-nums">{summary.online}</span> online
      </button>

      {#if summary.warning > 0}
        <button
          type="button"
          onclick={() => toggle("warning")}
          class="text-[11px] h-7 px-2 rounded-full border cursor-pointer transition {chipClass(
            activeFilter === 'warning',
            'warn',
          )}"
          title="Clusters with warning-level checks"
        >
          <span class="font-bold tabular-nums">{summary.warning}</span> warning
        </button>
      {/if}

      {#if summary.critical > 0}
        <button
          type="button"
          onclick={() => toggle("critical")}
          class="text-[11px] h-7 px-2 rounded-full border cursor-pointer transition {chipClass(
            activeFilter === 'critical',
            'danger',
          )}"
          title="Clusters with critical-level checks"
        >
          <span class="font-bold tabular-nums">{summary.critical}</span> critical
        </button>
      {/if}

      {#if summary.authErrors > 0}
        <button
          type="button"
          onclick={() => toggle("auth-error")}
          class="text-[11px] h-7 px-2 rounded-full border cursor-pointer transition {chipClass(
            activeFilter === 'auth-error',
            'warn',
          )}"
          title="Kubeconfig credentials were rejected (401/403/token expired)"
        >
          <span class="font-bold tabular-nums">{summary.authErrors}</span> auth
        </button>
      {/if}

      {#if summary.offline > 0}
        <button
          type="button"
          onclick={() => toggle("offline")}
          class="text-[11px] h-7 px-2 rounded-full border cursor-pointer transition {chipClass(
            activeFilter === 'offline',
            'danger',
          )}"
          title="Clusters the app cannot reach (connection refused, timeout, or flagged offline)"
        >
          <span class="font-bold tabular-nums">{summary.offline}</span> offline
        </button>
      {/if}

      {#if summary.unknown > 0}
        <button
          type="button"
          onclick={() => toggle("unknown")}
          class="text-[11px] h-7 px-2 rounded-full border cursor-pointer transition {chipClass(
            activeFilter === 'unknown',
            'muted',
          )}"
          title="Clusters without a recent successful health check"
        >
          <span class="font-bold tabular-nums">{summary.unknown}</span> unknown
        </button>
      {/if}
    </div>
  </div>
  {#if activeFilter}
    <div class="mt-2 text-[10px] text-slate-500">
      Filtering managed clusters by <span class="font-semibold">{activeFilter}</span>.
      <button
        type="button"
        class="ml-1 underline hover:text-slate-300"
        onclick={() => onFilter?.(null)}
      >
        Clear
      </button>
    </div>
  {/if}
</div>
