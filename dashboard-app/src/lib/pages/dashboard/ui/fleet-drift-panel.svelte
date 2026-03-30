<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Badge } from "$shared/ui/badge";
  import { fleetDrift, startAutoRecompute, stopAutoRecompute } from "$features/fleet-drift";
  import type { DriftDimension, DimensionSeverity } from "$features/fleet-drift";

  const state = $derived($fleetDrift);
  const snapshots = $derived(Object.values(state.snapshots));
  const totalDrifts = $derived(snapshots.reduce((sum, s) => sum + s.driftCount, 0));
  const clustersWithDrift = $derived(snapshots.filter((s) => s.driftCount > 0));
  const hasData = $derived(snapshots.length > 0);

  const sevColors: Record<DimensionSeverity, string> = {
    critical: "bg-rose-200 text-rose-900",
    high: "bg-amber-200 text-amber-900",
    medium: "bg-sky-200 text-sky-900",
    info: "bg-slate-200 text-slate-700",
  };

  const dimensionLabels: Record<DriftDimension, string> = {
    k8sVersion: "K8s Version",
    psaEnforcement: "Pod Security",
    resourceQuotas: "Resource Quotas",
    networkPolicyCoverage: "Network Policies",
    pdbCoverage: "PDB Coverage",
    imageFreshness: "Image Hygiene",
    ingressTls: "Ingress TLS",
    rbacOverprivileged: "RBAC Privileges",
    storagePending: "Storage Health",
    serviceMesh: "Service Mesh",
  };

  onMount(() => startAutoRecompute());
  onDestroy(() => stopAutoRecompute());
</script>

<section class="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
  <div class="flex items-start justify-between gap-3">
    <div class="space-y-1">
      <h3 class="text-sm font-semibold flex items-center gap-2">
        Fleet Drift Detector
        {#if hasData}
          <Badge class="text-white {totalDrifts > 0 ? 'bg-amber-600' : 'bg-emerald-600'} text-[11px]">
            {state.alignmentPercent}% aligned
          </Badge>
          {#if totalDrifts > 0}
            <span class="text-[11px] text-muted-foreground">
              {totalDrifts} drift{totalDrifts > 1 ? "s" : ""} across {clustersWithDrift.length}/{state.totalClusters} cluster{clustersWithDrift.length > 1 ? "s" : ""}
            </span>
          {/if}
        {/if}
      </h3>
      <p class="text-xs text-muted-foreground">
        Live cross-cluster comparison · 10 dimensions · auto-updates on refresh
      </p>
    </div>
  </div>

  {#if hasData && clustersWithDrift.length > 0}
    <div class="mt-3 overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="border-b text-left text-muted-foreground">
            <th class="py-1.5 pr-3 font-medium">Cluster</th>
            <th class="py-1.5 pr-3 font-medium">Drifts</th>
            <th class="py-1.5 font-medium">Dimensions</th>
          </tr>
        </thead>
        <tbody>
          {#each clustersWithDrift.sort((a, b) => b.driftCount - a.driftCount) as snapshot (snapshot.clusterId)}
            <tr class="border-b border-border/40">
              <td class="py-1.5 pr-3 font-medium truncate max-w-[180px]" title={snapshot.clusterName}>
                {snapshot.clusterName}
              </td>
              <td class="py-1.5 pr-3">
                <Badge class="text-white {snapshot.severity === 'critical' ? 'bg-rose-600' : 'bg-amber-600'} text-[10px]">
                  {snapshot.driftCount}
                </Badge>
              </td>
              <td class="py-1.5">
                <div class="flex flex-wrap gap-1">
                  {#each snapshot.drifts.filter((d) => d.isDrifted) as drift (drift.dimension)}
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-medium {sevColors[drift.dimensionSeverity]}"
                      title="{drift.label}: {drift.clusterValue} (fleet: {drift.fleetMajority})"
                    >
                      {drift.label}
                    </span>
                  {/each}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if hasData}
    <div class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      All {state.totalClusters} clusters are aligned across all 10 dimensions.
    </div>
  {:else}
    <div class="mt-3 text-xs text-muted-foreground">
      Waiting for cluster data to compute drift...
    </div>
  {/if}
</section>
