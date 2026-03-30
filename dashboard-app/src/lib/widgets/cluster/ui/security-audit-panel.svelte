<script lang="ts">
  import { type RbacRiskReport } from "$features/workloads-management/model/rbac-risk-scanner";
  import { type PssReport } from "$features/workloads-management/model/pss-compliance";
  import * as Card from "$shared/ui/card";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  let rbacRisk = $state<RbacRiskReport | null>(null);
  let pssReport = $state<PssReport | null>(null);
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <Card.Title class="text-sm">Security Audit</Card.Title>
    <p class="text-[10px] text-slate-500 mt-0.5">RBAC risk scanner (13 dangerous patterns per K8s best practices) and Pod Security Standards compliance checker (Baseline + Restricted levels).</p>
  </Card.Header>
  <Card.Content class="space-y-3 text-xs">
    <!-- RBAC Risk -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">RBAC Risk Scanner</h4>
      {#if rbacRisk}
        <div class="flex gap-3">
          <span class="text-slate-500">Roles scanned: <span class="text-slate-200 font-mono">{rbacRisk.summary.totalRoles}</span></span>
          <span class="text-rose-400 font-mono">{rbacRisk.summary.criticalCount} critical</span>
          <span class="text-amber-400 font-mono">{rbacRisk.summary.highCount} high</span>
          <span class="text-yellow-400 font-mono">{rbacRisk.summary.mediumCount} medium</span>
          <span class="text-emerald-400 font-mono">{rbacRisk.summary.cleanCount} clean</span>
        </div>
        {#if rbacRisk.summary.criticalCount > 0}
          <div class="mt-1 space-y-0.5">
            {#each rbacRisk.roles.filter(r => r.highestRisk === "critical").slice(0, 3) as role (role.name)}
              <div class="flex items-center gap-1.5 text-[10px]">
                <span class="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                <span class="text-slate-300 font-mono">{role.kind}/{role.name}</span>
                <span class="text-slate-500">{role.findings.length} findings</span>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="text-slate-500 italic">Run RBAC audit from Overview page</p>
      {/if}
    </div>

    <!-- PSS Compliance -->
    <div class="rounded border border-slate-700 p-2">
      <h4 class="text-[11px] font-semibold text-slate-300 mb-1">Pod Security Standards</h4>
      {#if pssReport}
        <div class="flex gap-3">
          <span class="text-slate-500">Pods: <span class="text-slate-200 font-mono">{pssReport.summary.total}</span></span>
          <span class="text-emerald-400">{pssReport.summary.restrictedCompliant} restricted</span>
          <span class="text-amber-400">{pssReport.summary.baselineCompliant} baseline</span>
          <span class="text-rose-400">{pssReport.summary.privilegedOnly} privileged</span>
        </div>
      {:else}
        <p class="text-slate-500 italic">Run PSS compliance check from Overview page</p>
      {/if}
    </div>
  </Card.Content>
</Card.Root>
