<script lang="ts">
  import {
    buildResourceHeatmap,
    type ResourceHeatmapReport,
  } from "$features/workloads-management/model/resource-heatmap";
  import {
    calculateBinPacking,
    type BinPackingReport,
  } from "$features/workloads-management/model/bin-packing";
  import {
    calculateCostEfficiency,
    type CostEfficiencyReport,
  } from "$features/workloads-management/model/cost-efficiency";
  import * as Card from "$shared/ui/card";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  // These would be populated from real cluster data in production.
  // For now, show the panel structure with placeholder data.
  let heatmap = $state<ResourceHeatmapReport | null>(null);
  let binPacking = $state<BinPackingReport | null>(null);
  let costReport = $state<CostEfficiencyReport | null>(null);
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <Card.Title class="text-sm">Capacity Intelligence</Card.Title>
    <p class="text-[10px] text-slate-500 mt-0.5">
      Resource efficiency heatmap, node bin-packing score, and cost analysis with savings
      opportunities. Data from metrics-server and Prometheus.
    </p>
  </Card.Header>
  <Card.Content class="space-y-3 text-xs">
    <!-- Resource Efficiency -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">Resource Efficiency</h4>
      {#if heatmap}
        <div class="grid grid-cols-2 gap-2">
          <div>
            <span class="text-slate-500">Avg CPU efficiency:</span>
            <span class="font-mono text-slate-200 ml-1">{heatmap.summary.avgCpuEfficiency}%</span>
          </div>
          <div>
            <span class="text-slate-500">Avg Memory efficiency:</span>
            <span class="font-mono text-slate-200 ml-1">{heatmap.summary.avgMemoryEfficiency}%</span
            >
          </div>
          <div>
            <span class="text-slate-500">Over-provisioned:</span>
            <span class="font-mono text-amber-400 ml-1">{heatmap.summary.overProvisionedCount}</span
            >
          </div>
          <div>
            <span class="text-slate-500">Under-provisioned:</span>
            <span class="font-mono text-rose-400 ml-1">{heatmap.summary.underProvisionedCount}</span
            >
          </div>
        </div>
      {:else}
        <p class="text-slate-500 italic">No efficiency data available yet</p>
      {/if}
    </div>

    <!-- Bin Packing -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">Bin Packing</h4>
      {#if binPacking}
        <div class="flex items-center gap-3">
          <span class="text-slate-500">Cluster score:</span>
          <span
            class="font-mono text-lg {binPacking.clusterScore >= 80
              ? 'text-emerald-400'
              : binPacking.clusterScore >= 50
                ? 'text-amber-400'
                : 'text-rose-400'}">{binPacking.clusterScore}%</span
          >
          <span class="text-slate-500 text-[10px]">({binPacking.clusterGrade})</span>
          <span class="text-slate-500">Fragmentation:</span>
          <span class="font-mono text-slate-200">{binPacking.fragmentationPercent}%</span>
        </div>
      {:else}
        <p class="text-slate-500 italic">No bin-packing data available yet</p>
      {/if}
    </div>

    <!-- Cost Efficiency -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">Cost Efficiency</h4>
      {#if costReport}
        <div class="grid grid-cols-2 gap-2">
          <div>
            <span class="text-slate-500">Monthly cost:</span>
            <span class="font-mono text-slate-200 ml-1"
              >${costReport.totals.totalMonthly.toFixed(0)}</span
            >
          </div>
          <div>
            <span class="text-slate-500">Wasted:</span>
            <span class="font-mono text-rose-400 ml-1"
              >${costReport.totals.wastedMonthly.toFixed(0)}</span
            >
          </div>
          <div>
            <span class="text-slate-500">Efficiency:</span>
            <span class="font-mono text-slate-200 ml-1">{costReport.totals.efficiencyPercent}%</span
            >
          </div>
          <div>
            <span class="text-slate-500">Savings opportunity:</span>
            <span class="font-mono text-emerald-400 ml-1"
              >${costReport.totals.savingsOpportunity.toFixed(0)}/mo</span
            >
          </div>
        </div>
      {:else}
        <p class="text-slate-500 italic">No cost data available yet</p>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
