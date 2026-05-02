<script lang="ts">
  import { type RedMetricsReport } from "$features/workloads-management/model/red-metrics";
  import { type CpuThrottlingReport } from "$features/workloads-management/model/cpu-throttling";
  import { type SloReport } from "$features/workloads-management/model/slo-tracking";
  import * as Card from "$shared/ui/card";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  let redMetrics = $state<RedMetricsReport | null>(null);
  let throttling = $state<CpuThrottlingReport | null>(null);
  let sloReport = $state<SloReport | null>(null);
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <Card.Title class="text-sm">Performance Observability</Card.Title>
    <p class="text-[10px] text-slate-500 mt-0.5">
      RED metrics (Rate/Errors/Duration), CPU throttling detection, and SLO error budget tracking.
      Requires Prometheus with apiserver and cAdvisor metrics.
    </p>
  </Card.Header>
  <Card.Content class="space-y-3 text-xs">
    <!-- RED Metrics -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">
        RED Metrics (Rate / Errors / Duration)
      </h4>
      {#if redMetrics}
        <div class="grid grid-cols-3 gap-2">
          <div>
            <span class="text-slate-500">Total rate:</span>
            <span class="font-mono text-slate-200 ml-1">{redMetrics.summary.totalRate} req/s</span>
          </div>
          <div>
            <span class="text-slate-500">Avg errors:</span>
            <span
              class="font-mono {redMetrics.summary.avgErrorPercent > 1
                ? 'text-rose-400'
                : 'text-slate-200'} ml-1">{redMetrics.summary.avgErrorPercent}%</span
            >
          </div>
          <div>
            <span class="text-slate-500">Avg p95:</span>
            <span
              class="font-mono {redMetrics.summary.avgP95LatencyMs > 1000
                ? 'text-amber-400'
                : 'text-slate-200'} ml-1">{redMetrics.summary.avgP95LatencyMs}ms</span
            >
          </div>
        </div>
        <div class="flex gap-2 mt-1">
          <span class="text-emerald-400">{redMetrics.summary.healthyCount} healthy</span>
          <span class="text-amber-400">{redMetrics.summary.degradedCount} degraded</span>
          <span class="text-rose-400">{redMetrics.summary.criticalCount} critical</span>
        </div>
      {:else}
        <p class="text-slate-500 italic">No RED metrics data available yet</p>
      {/if}
    </div>

    <!-- CPU Throttling -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">CPU Throttling</h4>
      {#if throttling}
        <div class="flex gap-4">
          <span class="text-slate-500"
            >Containers: <span class="text-slate-200 font-mono"
              >{throttling.summary.totalContainers}</span
            ></span
          >
          <span class="text-slate-500"
            >Throttled: <span class="text-amber-400 font-mono"
              >{throttling.summary.throttledContainers}</span
            ></span
          >
          <span class="text-slate-500"
            >Critical: <span class="text-rose-400 font-mono"
              >{throttling.summary.criticalCount}</span
            ></span
          >
        </div>
      {:else}
        <p class="text-slate-500 italic">No throttling data available yet</p>
      {/if}
    </div>

    <!-- SLOs -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">SLO Tracking</h4>
      {#if sloReport}
        <div class="flex gap-3">
          <span class="text-emerald-400">{sloReport.summary.ok} OK</span>
          <span class="text-amber-400">{sloReport.summary.warning} Warning</span>
          <span class="text-rose-400">{sloReport.summary.critical} Critical</span>
          <span class="text-red-600">{sloReport.summary.exhausted} Exhausted</span>
        </div>
      {:else}
        <p class="text-slate-500 italic">No SLO data available yet</p>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
