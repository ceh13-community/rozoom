<script lang="ts">
  import { onMount } from "svelte";
  import {
    buildResourceHeatmap,
    type ResourceHeatmapEntry,
    type ResourceHeatmapReport,
  } from "$features/workloads-management/model/resource-heatmap";
  import {
    calculateBinPacking,
    type BinPackingNodeScore,
    type BinPackingReport,
  } from "$features/workloads-management/model/bin-packing";
  import {
    calculateCostEfficiency,
    DEFAULT_PRICING,
    type CostEfficiencyEntry,
    type CostEfficiencyReport,
    type CostPricing,
  } from "$features/workloads-management/model/cost-efficiency";
  import {
    aggregateByNamespace,
    joinWorkloadMetrics,
    nodesFromJson,
    nodeUsageFromMetrics,
    podRequestsFromJson,
    podsOnNodesFromJson,
    podUsageFromMetrics,
  } from "$features/capacity-intelligence";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import * as Card from "$shared/ui/card";
  import * as Alert from "$shared/ui/alert";
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
    offline?: boolean;
  }

  const { clusterId, offline = false }: Props = $props();

  type Phase = "idle" | "running" | "done" | "error";

  let phase = $state<Phase>("idle");
  let errorMessage = $state<string | null>(null);
  let metricsMissing = $state(false);
  let lastScanAt = $state<number | null>(null);
  let heatmap = $state<ResourceHeatmapReport | null>(null);
  let binPacking = $state<BinPackingReport | null>(null);
  let costReport = $state<CostEfficiencyReport | null>(null);

  // User-adjustable pricing. Defaults are a conservative on-demand approximation
  // for US regions; real cloud billing depends on instance family, commitments
  // and discounts. Users override for accurate $ numbers.
  let pricing = $state<CostPricing>({ ...DEFAULT_PRICING });
  let pricingDirty = $state(false);

  const HEATMAP_ROW_LIMIT = 15;
  const COST_ROW_LIMIT = 10;
  const BIN_NODE_LIMIT = 20;

  function relativeTime(ts: number | null): string {
    if (!ts) return "never";
    const diffMs = Date.now() - ts;
    if (diffMs < 60_000) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  }

  function millicoresLabel(m: number): string {
    if (m >= 1000) return `${(m / 1000).toFixed(1)} cores`;
    return `${Math.round(m)}m`;
  }

  function memLabel(mib: number): string {
    if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
    return `${Math.round(mib)} MiB`;
  }

  function moneyLabel(n: number): string {
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${Math.round(n)}`;
  }

  function heatmapRowBadge(grade: ResourceHeatmapEntry["grade"]): string {
    switch (grade) {
      case "optimal":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
      case "under-provisioned":
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
      case "over-provisioned":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      case "idle":
        return "bg-sky-500/15 text-sky-300 border-sky-500/40";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  }

  function nodeBadgeClass(grade: BinPackingNodeScore["grade"]): string {
    switch (grade) {
      case "tight":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
      case "balanced":
        return "bg-amber-500/15 text-amber-300 border-amber-500/40";
      case "sparse":
        return "bg-rose-500/15 text-rose-300 border-rose-500/40";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  }

  async function runScan() {
    if (phase === "running" || offline) return;
    phase = "running";
    errorMessage = null;
    metricsMissing = false;
    try {
      const [nodesResp, podsResp, podMetricsResp, nodeMetricsResp] = await Promise.all([
        kubectlJson<{ items?: unknown[] }>("get nodes --request-timeout=15s", { clusterId }),
        kubectlJson<{ items?: unknown[] }>("get pods --all-namespaces --request-timeout=30s", {
          clusterId,
        }),
        kubectlJson<{ items?: unknown[] }>(
          'get --raw="/apis/metrics.k8s.io/v1beta1/pods" --request-timeout=15s',
          { clusterId },
        ),
        kubectlJson<{ items?: unknown[] }>(
          'get --raw="/apis/metrics.k8s.io/v1beta1/nodes" --request-timeout=15s',
          { clusterId },
        ),
      ]);

      if (typeof nodesResp === "string") throw new Error(`Nodes: ${nodesResp}`);
      if (typeof podsResp === "string") throw new Error(`Pods: ${podsResp}`);

      // metrics-server is optional but heavily useful. Record which ones
      // failed so the UI can surface an install hint without blocking the
      // parts that do not need metrics (bin-packing works from requests).
      const podMetricsOk = typeof podMetricsResp !== "string";
      const nodeMetricsOk = typeof nodeMetricsResp !== "string";
      metricsMissing = !podMetricsOk || !nodeMetricsOk;

      const requests = podRequestsFromJson(podsResp as Parameters<typeof podRequestsFromJson>[0]);
      const usage = podUsageFromMetrics(
        podMetricsOk ? (podMetricsResp as Parameters<typeof podUsageFromMetrics>[0]) : null,
      );
      const workloadMetrics = joinWorkloadMetrics(requests, usage);
      const namespaceMetrics = aggregateByNamespace(workloadMetrics);

      const podsOnNodes = podsOnNodesFromJson(
        podsResp as Parameters<typeof podsOnNodesFromJson>[0],
      );
      const nodeInputs = nodesFromJson(
        nodesResp as Parameters<typeof nodesFromJson>[0],
        podsOnNodes,
      );
      // nodeUsage exists but the current bin-packing model scores on
      // requests-vs-allocatable (K8s scheduler model). We parse it so future
      // UI can show live-usage tooltips alongside the packing score.
      nodeUsageFromMetrics(
        nodeMetricsOk ? (nodeMetricsResp as Parameters<typeof nodeUsageFromMetrics>[0]) : null,
      );

      heatmap = buildResourceHeatmap(workloadMetrics);
      binPacking = calculateBinPacking(nodeInputs);
      costReport = calculateCostEfficiency(namespaceMetrics, pricing);
      lastScanAt = Date.now();
      phase = "done";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      phase = "error";
    }
  }

  function recomputeCost() {
    if (!heatmap) return;
    const namespaceMetrics = aggregateByNamespace(
      heatmap.entries.map((e) => ({
        namespace: e.namespace,
        workload: e.workload,
        workloadType: e.workloadType,
        cpuRequestMillicores: e.cpuRequestMillicores,
        cpuUsageMillicores: e.cpuUsageMillicores,
        memoryRequestMiB: e.memoryRequestMiB,
        memoryUsageMiB: e.memoryUsageMiB,
      })),
    );
    costReport = calculateCostEfficiency(namespaceMetrics, pricing);
    pricingDirty = false;
  }

  function resetPricing() {
    pricing = { ...DEFAULT_PRICING };
    pricingDirty = false;
    if (heatmap) recomputeCost();
  }

  const topOverProvisioned = $derived<ResourceHeatmapEntry[]>(
    (heatmap?.entries ?? [])
      .filter((e) => e.grade === "over-provisioned" || e.grade === "idle")
      .slice(0, HEATMAP_ROW_LIMIT),
  );
  const topUnderProvisioned = $derived<ResourceHeatmapEntry[]>(
    (heatmap?.entries ?? []).filter((e) => e.grade === "under-provisioned").slice(0, 10),
  );
  const topWastedNamespaces = $derived<CostEfficiencyEntry[]>(
    (costReport?.entries ?? []).filter((e) => e.wastedTotalMonthly > 0).slice(0, COST_ROW_LIMIT),
  );

  onMount(() => {
    if (!offline) void runScan();
  });
</script>

<div class="space-y-4">
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <Card.Title class="text-base">Cost & Efficiency</Card.Title>
          <p class="text-xs text-muted-foreground mt-0.5">
            Per-workload resource efficiency, node bin-packing, and a ballpark monthly cost for what
            you ask the scheduler to reserve. Uses only
            <a
              href="https://github.com/kubernetes-sigs/metrics-server/blob/master/docs/api.md"
              target="_blank"
              rel="noreferrer"
              class="text-sky-400 hover:underline">metrics.k8s.io</a
            >
            plus pod/node specs. No external cost provider, no data leaves the machine.
          </p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[11px] text-muted-foreground">
            Last scan: {relativeTime(lastScanAt)}
          </span>
          <Button
            size="sm"
            variant="outline"
            onclick={runScan}
            disabled={phase === "running" || offline}
          >
            {#if phase === "running"}
              Scanning<LoadingDots />
            {:else}
              {lastScanAt ? "Rescan" : "Scan now"}
            {/if}
          </Button>
        </div>
      </div>
    </Card.Header>
  </Card.Root>

  {#if offline}
    <Alert.Root>
      <Alert.Description>Cluster is offline. Reconnect to scan.</Alert.Description>
    </Alert.Root>
  {/if}

  {#if phase === "error" && errorMessage}
    <Alert.Root variant="destructive">
      <Alert.Title>Scan failed</Alert.Title>
      <Alert.Description>
        <pre class="whitespace-pre-wrap text-xs">{errorMessage}</pre>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if metricsMissing && phase === "done"}
    <Alert.Root>
      <Alert.Title>metrics-server unavailable</Alert.Title>
      <Alert.Description class="text-xs">
        Could not reach <code>/apis/metrics.k8s.io/v1beta1/</code>. Bin-packing still works
        (scheduler view), but efficiency and cost rely on actual usage. Install metrics-server from
        <strong>Helm Catalog → metrics-server</strong> to get live numbers.
      </Alert.Description>
    </Alert.Root>
  {/if}

  <!-- Bin packing -->
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between">
        <Card.Title class="text-sm">Bin Packing (scheduler view)</Card.Title>
        {#if binPacking}
          <span class="text-[11px] text-muted-foreground">{binPacking.nodes.length} nodes</span>
        {/if}
      </div>
      <p class="text-[11px] text-muted-foreground">
        How tightly pod requests fill each node's allocatable capacity.
        <a
          href="https://kubernetes.io/docs/concepts/scheduling-eviction/"
          target="_blank"
          rel="noreferrer"
          class="text-sky-400 hover:underline">Allocatable</a
        >
        is what the scheduler actually uses for placement decisions.
      </p>
    </Card.Header>
    <Card.Content class="space-y-3">
      {#if phase === "idle"}
        <p class="text-xs text-muted-foreground">
          Click <strong>Scan now</strong> to compute bin-packing from <code>kubectl get nodes</code>
          + <code>kubectl get pods -A</code>.
        </p>
      {:else if binPacking && binPacking.nodes.length > 0}
        <div class="flex flex-wrap items-center gap-3 text-xs">
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">Cluster score:</span>
            <span
              class="font-mono text-lg {binPacking.clusterScore >= 80
                ? 'text-emerald-400'
                : binPacking.clusterScore >= 50
                  ? 'text-amber-400'
                  : 'text-rose-400'}"
            >
              {binPacking.clusterScore}%
            </span>
            <Badge variant="outline" class="text-[10px] {nodeBadgeClass(binPacking.clusterGrade)}">
              {binPacking.clusterGrade}
            </Badge>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">Fragmentation:</span>
            <span class="font-mono">{binPacking.fragmentationPercent}%</span>
          </div>
        </div>

        <div class="grid gap-1.5">
          {#each binPacking.nodes.slice(0, BIN_NODE_LIMIT) as node (node.name)}
            <div class="flex items-center gap-2 rounded border border-border bg-background/50 p-2">
              <Badge variant="outline" class="text-[10px] {nodeBadgeClass(node.grade)}">
                {node.grade}
              </Badge>
              <span class="font-mono text-xs">{node.name}</span>
              <div class="ml-auto flex items-center gap-3 text-[11px]">
                <span class="text-muted-foreground">
                  CPU <span class="font-mono text-foreground">{node.cpuPackingPercent}%</span>
                </span>
                <span class="text-muted-foreground">
                  Mem <span class="font-mono text-foreground">{node.memoryPackingPercent}%</span>
                </span>
                <span
                  class="font-mono {node.score >= 80
                    ? 'text-emerald-400'
                    : node.score >= 50
                      ? 'text-amber-400'
                      : 'text-rose-400'}"
                >
                  score {node.score}
                </span>
              </div>
            </div>
          {/each}
          {#if binPacking.nodes.length > BIN_NODE_LIMIT}
            <p class="text-[11px] text-muted-foreground">
              Showing {BIN_NODE_LIMIT} of {binPacking.nodes.length} nodes.
            </p>
          {/if}
        </div>
        <p class="text-[11px] text-muted-foreground">
          <strong class="text-emerald-400">tight</strong> &ge; 80% packed.
          <strong class="text-amber-400">balanced</strong> &ge; 50%.
          <strong class="text-rose-400">sparse</strong> nodes waste their provisioning; consolidate with
          a cluster-autoscaler or manually cordon + drain the emptiest ones.
        </p>
      {:else if phase === "done"}
        <p class="text-xs text-muted-foreground">No nodes returned. Is the cluster empty?</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Resource efficiency -->
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between">
        <Card.Title class="text-sm">Resource Efficiency</Card.Title>
        {#if heatmap}
          <span class="text-[11px] text-muted-foreground">
            {heatmap.entries.length} workloads
          </span>
        {/if}
      </div>
      <p class="text-[11px] text-muted-foreground">
        Per-workload <code>requests</code> versus live usage. Rolled up to Deployment / StatefulSet /
        DaemonSet so a single row is actionable (update one manifest).
      </p>
    </Card.Header>
    <Card.Content class="space-y-3">
      {#if phase === "idle"}
        <p class="text-xs text-muted-foreground">Click Scan to compute efficiency.</p>
      {:else if heatmap}
        <div class="flex flex-wrap gap-3 text-xs">
          <span class="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono">
            {heatmap.summary.optimalCount} optimal
          </span>
          <span class="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-mono">
            {heatmap.summary.overProvisionedCount} over-provisioned
          </span>
          <span class="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono">
            {heatmap.summary.underProvisionedCount} under-provisioned
          </span>
          <span class="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 font-mono">
            {heatmap.summary.idleCount} idle
          </span>
          <span class="rounded border border-border bg-muted px-2 py-1 font-mono">
            {heatmap.summary.noRequestsCount} no-requests
          </span>
        </div>
        <div class="flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <span>
            Avg CPU efficiency
            <span class="font-mono text-foreground">{heatmap.summary.avgCpuEfficiency}%</span>
          </span>
          <span>
            Avg Mem efficiency
            <span class="font-mono text-foreground">{heatmap.summary.avgMemoryEfficiency}%</span>
          </span>
        </div>

        {#if topOverProvisioned.length > 0}
          <section class="space-y-1">
            <h4 class="text-xs font-semibold">Biggest over-provisioners (cut requests)</h4>
            {#each topOverProvisioned as entry (`${entry.namespace}/${entry.workload}`)}
              <div
                class="flex items-center gap-2 rounded border border-border bg-background/50 p-2 text-xs"
              >
                <Badge variant="outline" class="text-[10px] {heatmapRowBadge(entry.grade)}">
                  {entry.grade}
                </Badge>
                <span class="font-mono">
                  {entry.workloadType}/{entry.namespace}/{entry.workload}
                </span>
                <span class="ml-auto text-[11px] text-muted-foreground">
                  CPU <span class="font-mono text-foreground"
                    >{millicoresLabel(entry.cpuUsageMillicores)}/{millicoresLabel(
                      entry.cpuRequestMillicores,
                    )}</span
                  >
                  ({entry.cpuEfficiency}%) · Mem
                  <span class="font-mono text-foreground"
                    >{memLabel(entry.memoryUsageMiB)}/{memLabel(entry.memoryRequestMiB)}</span
                  >
                  ({entry.memoryEfficiency}%)
                </span>
              </div>
            {/each}
          </section>
        {/if}

        {#if topUnderProvisioned.length > 0}
          <section class="space-y-1">
            <h4 class="text-xs font-semibold text-rose-300">
              Under-provisioned (raise requests or add replicas)
            </h4>
            {#each topUnderProvisioned as entry (`${entry.namespace}/${entry.workload}`)}
              <div
                class="flex items-center gap-2 rounded border border-border bg-background/50 p-2 text-xs"
              >
                <Badge variant="outline" class="text-[10px] {heatmapRowBadge(entry.grade)}">
                  {entry.grade}
                </Badge>
                <span class="font-mono">
                  {entry.workloadType}/{entry.namespace}/{entry.workload}
                </span>
                <span class="ml-auto text-[11px] text-muted-foreground">
                  CPU <span class="font-mono text-rose-300">{entry.cpuEfficiency}%</span>
                  · Mem <span class="font-mono text-rose-300">{entry.memoryEfficiency}%</span>
                </span>
              </div>
            {/each}
          </section>
        {/if}

        {#if heatmap.summary.noRequestsCount > 0}
          <p class="text-[11px] text-muted-foreground">
            {heatmap.summary.noRequestsCount} workloads have no CPU/memory requests at all - those pods
            get <code>BestEffort</code> QoS and are evicted first under node pressure. Add requests to
            give them a scheduling reservation.
          </p>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- Cost -->
  <Card.Root>
    <Card.Header class="pb-3">
      <div class="flex items-center justify-between">
        <Card.Title class="text-sm">Cost Estimate</Card.Title>
        {#if costReport}
          <span class="text-[11px] text-muted-foreground">
            {costReport.entries.length} namespaces
          </span>
        {/if}
      </div>
      <p class="text-[11px] text-muted-foreground">
        Ballpark monthly cost of what the scheduler has reserved (requests, not usage). Default
        pricing is a conservative on-demand approximation for US regions; override with your actual
        provider rate for accurate numbers. Committed-use or savings-plan discounts are not
        modelled.
      </p>
    </Card.Header>
    <Card.Content class="space-y-3">
      <!-- Pricing controls -->
      <div class="flex flex-wrap items-end gap-3 rounded border border-border bg-muted/20 p-2">
        <label class="text-[11px] text-muted-foreground">
          CPU $/core/month
          <input
            type="number"
            min="0"
            step="1"
            bind:value={pricing.cpuPerCoreMonth}
            oninput={() => (pricingDirty = true)}
            class="ml-1 h-7 w-24 rounded border border-border bg-background px-2 text-sm"
          />
        </label>
        <label class="text-[11px] text-muted-foreground">
          Memory $/GiB/month
          <input
            type="number"
            min="0"
            step="0.5"
            bind:value={pricing.memoryPerGiBMonth}
            oninput={() => (pricingDirty = true)}
            class="ml-1 h-7 w-24 rounded border border-border bg-background px-2 text-sm"
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={!pricingDirty || !heatmap}
          onclick={recomputeCost}>Apply</Button
        >
        <Button size="sm" variant="ghost" onclick={resetPricing}>Reset to default</Button>
      </div>

      {#if phase === "idle"}
        <p class="text-xs text-muted-foreground">Click Scan to compute cost estimates.</p>
      {:else if costReport}
        <div class="flex flex-wrap gap-3 text-xs">
          <span class="rounded border border-border bg-background px-2 py-1 font-mono">
            Monthly: {moneyLabel(costReport.totals.totalMonthly)}
          </span>
          <span class="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono">
            Wasted: {moneyLabel(costReport.totals.wastedMonthly)}
          </span>
          <span class="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 font-mono">
            Efficiency: {costReport.totals.efficiencyPercent}%
          </span>
          <span class="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 font-mono">
            Savings: {moneyLabel(costReport.totals.savingsOpportunity)}/mo
          </span>
        </div>

        {#if topWastedNamespaces.length > 0}
          <section class="space-y-1">
            <h4 class="text-xs font-semibold">Namespaces with most waste</h4>
            {#each topWastedNamespaces as ns (ns.namespace)}
              <div
                class="flex flex-wrap items-center gap-2 rounded border border-border bg-background/50 p-2 text-xs"
              >
                <span class="font-mono">{ns.namespace}</span>
                <span class="ml-auto text-[11px] text-muted-foreground">
                  Billed <span class="font-mono text-foreground"
                    >{moneyLabel(ns.totalCostMonthly)}</span
                  >
                  · Wasted
                  <span class="font-mono text-rose-300">{moneyLabel(ns.wastedTotalMonthly)}/mo</span
                  >
                  · CPU eff
                  <span class="font-mono text-foreground">{ns.cpuEfficiency}%</span>
                  · Mem eff
                  <span class="font-mono text-foreground">{ns.memoryEfficiency}%</span>
                </span>
              </div>
            {/each}
          </section>
        {/if}
      {/if}
    </Card.Content>
  </Card.Root>
</div>
