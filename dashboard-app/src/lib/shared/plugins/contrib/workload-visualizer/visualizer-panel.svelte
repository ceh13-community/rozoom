<script lang="ts">
  import {
    buildDependencyGraph,
    type DependencyGraph,
    type GraphNode,
    type GraphEdge,
  } from "./model";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import * as Card from "$shared/ui/card";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  let graph = $state<DependencyGraph | null>(null);
  let selectedNode = $state<GraphNode | null>(null);
  let filterKind = $state<string>("all");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let namespace = $state("all");

  async function fetchResources() {
    loading = true;
    error = null;
    selectedNode = null;
    try {
      const ns = namespace === "all" ? "--all-namespaces" : `-n ${namespace}`;
      const opts = { clusterId };

      const [
        ingresses,
        services,
        deployments,
        statefulsets,
        daemonsets,
        pods,
        configmaps,
        secrets,
        pvcs,
        serviceaccounts,
        networkpolicies,
        hpas,
      ] = await Promise.allSettled([
        kubectlJson<{ items: unknown[] }>(`get ingresses ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get services ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get deployments ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get statefulsets ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get daemonsets ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get pods ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get configmaps ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get secrets ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get pvc ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get serviceaccounts ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get networkpolicies ${ns} -o json`, opts),
        kubectlJson<{ items: unknown[] }>(`get hpa ${ns} -o json`, opts),
      ]);

      type SettledList = PromiseSettledResult<string | { items: unknown[] }>;
      const items = (r: SettledList) =>
        r.status === "fulfilled" && typeof r.value !== "string"
          ? (r.value.items as Record<string, unknown>[])
          : [];

      graph = buildDependencyGraph({
        ingresses: items(ingresses),
        services: items(services),
        deployments: items(deployments),
        statefulsets: items(statefulsets),
        daemonsets: items(daemonsets),
        pods: items(pods),
        configmaps: items(configmaps),
        secrets: items(secrets),
        pvcs: items(pvcs),
        serviceaccounts: items(serviceaccounts),
        networkpolicies: items(networkpolicies),
        hpas: items(hpas),
      });
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  }

  $effect(() => {
    if (clusterId) void fetchResources();
  });

  const kindIcons: Record<string, string> = {
    Ingress: "IN",
    Service: "SV",
    Deployment: "DP",
    StatefulSet: "SS",
    ReplicaSet: "RS",
    DaemonSet: "DS",
    Pod: "PO",
    ConfigMap: "CM",
    Secret: "SC",
    PersistentVolumeClaim: "PV",
    ServiceAccount: "SA",
    Role: "RO",
    ClusterRole: "CR",
    NetworkPolicy: "NP",
    HPA: "HP",
  };

  const kindColors: Record<string, string> = {
    Ingress: "bg-violet-500/20 border-violet-500/40 text-violet-300",
    Service: "bg-blue-500/20 border-blue-500/40 text-blue-300",
    Deployment: "bg-indigo-500/20 border-indigo-500/40 text-indigo-300",
    StatefulSet: "bg-indigo-500/20 border-indigo-500/40 text-indigo-300",
    DaemonSet: "bg-indigo-500/20 border-indigo-500/40 text-indigo-300",
    ReplicaSet: "bg-slate-500/20 border-slate-500/40 text-slate-300",
    Pod: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
    ConfigMap: "bg-amber-500/20 border-amber-500/40 text-amber-300",
    Secret: "bg-rose-500/20 border-rose-500/40 text-rose-300",
    PersistentVolumeClaim: "bg-cyan-500/20 border-cyan-500/40 text-cyan-300",
    ServiceAccount: "bg-orange-500/20 border-orange-500/40 text-orange-300",
    NetworkPolicy: "bg-teal-500/20 border-teal-500/40 text-teal-300",
    HPA: "bg-pink-500/20 border-pink-500/40 text-pink-300",
  };

  const statusDot: Record<string, string> = {
    healthy: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-rose-400",
    unknown: "bg-slate-500",
  };

  const filteredNodes = $derived(
    graph?.nodes.filter((n) => filterKind === "all" || n.kind === filterKind) ?? [],
  );

  function nodeEdges(nodeId: string): GraphEdge[] {
    return graph?.edges.filter((e) => e.source === nodeId || e.target === nodeId) ?? [];
  }
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <div class="flex items-center justify-between">
      <div>
        <Card.Title class="text-sm">Workload Visualizer</Card.Title>
        <p class="text-[10px] text-slate-500 mt-0.5">
          Dependency map: Ingress -> Service -> Deployment -> Pod -> ConfigMap/Secret/PVC/RBAC.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={namespace}
          placeholder="all"
          class="h-6 w-24 text-[10px] px-1.5 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
        />
        <Button
          size="sm"
          variant="outline"
          class="text-[10px] h-6 px-2"
          disabled={loading}
          onclick={fetchResources}
        >
          {loading ? "Scanning" : "Refresh"}
        </Button>
      </div>
    </div>
  </Card.Header>
  <Card.Content class="space-y-3 text-xs">
    {#if error}
      <div class="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-2 py-1">
        {error}
      </div>
    {/if}

    {#if loading}
      <div class="flex items-center gap-2 text-slate-400 py-4 justify-center">
        <span class="animate-spin text-sm">&#9696;</span> Scanning cluster resources<LoadingDots />
      </div>
    {:else if graph}
      <!-- Summary -->
      <div class="flex flex-wrap gap-3 text-[10px]">
        <span class="text-slate-300 font-medium">{graph.summary.totalNodes} resources</span>
        <span class="text-slate-400">{graph.summary.totalEdges} connections</span>
        {#if graph.summary.orphanedNodes > 0}
          <span class="text-amber-400">{graph.summary.orphanedNodes} orphaned</span>
        {/if}
      </div>

      <!-- Kind filter -->
      <div class="flex flex-wrap gap-1">
        <button
          class="text-[10px] px-2 py-0.5 rounded border transition {filterKind === 'all'
            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
            : 'border-slate-600 text-slate-500 hover:border-slate-400'}"
          onclick={() => (filterKind = "all")}>All ({graph.summary.totalNodes})</button
        >
        {#each Object.entries(graph.summary.byKind).sort((a, b) => b[1] - a[1]) as [kind, count] (kind)}
          <button
            class="text-[10px] px-2 py-0.5 rounded border transition {filterKind === kind
              ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
              : 'border-slate-600 text-slate-500 hover:border-slate-400'}"
            onclick={() => (filterKind = filterKind === kind ? "all" : kind)}
            >{kind} ({count})</button
          >
        {/each}
      </div>

      <!-- Node grid -->
      <div
        class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1.5 max-h-[400px] overflow-y-auto"
      >
        {#each filteredNodes as node (node.id)}
          <button
            class="text-left rounded-lg border p-2 transition hover:brightness-125 {kindColors[
              node.kind
            ] ?? 'bg-slate-500/20 border-slate-500/40 text-slate-300'} {selectedNode?.id === node.id
              ? 'ring-1 ring-indigo-400'
              : ''}"
            onclick={() => (selectedNode = selectedNode?.id === node.id ? null : node)}
          >
            <div class="flex items-center gap-1.5">
              <span class="text-[9px] font-bold opacity-60 w-4">{kindIcons[node.kind] ?? "?"}</span>
              {#if node.status}
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {statusDot[node.status]}"></span>
              {/if}
              <span class="truncate text-[11px] font-medium">{node.name}</span>
            </div>
            <span class="text-[9px] opacity-50">{node.namespace}</span>
          </button>
        {/each}
      </div>

      <!-- Selected node detail -->
      {#if selectedNode}
        <div class="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-indigo-300"
              >{selectedNode.kind}/{selectedNode.name}</span
            >
            <span class="text-[9px] text-slate-500">{selectedNode.namespace}</span>
            {#if selectedNode.status}
              <span
                class="text-[9px] px-1.5 py-0.5 rounded-full {selectedNode.status === 'healthy'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : selectedNode.status === 'warning'
                    ? 'bg-amber-500/10 text-amber-400'
                    : selectedNode.status === 'error'
                      ? 'bg-rose-500/10 text-rose-400'
                      : 'bg-slate-500/10 text-slate-400'}">{selectedNode.status}</span
              >
            {/if}
          </div>

          {#if nodeEdges(selectedNode.id).length > 0}
            {@const connections = nodeEdges(selectedNode.id)}
            <div class="space-y-0.5">
              {#each connections as edge (edge.source + edge.target)}
                {@const isSource = edge.source === selectedNode.id}
                {@const otherId = isSource ? edge.target : edge.source}
                {@const otherNode = graph?.nodes.find((n) => n.id === otherId)}
                <div class="flex items-center gap-1.5 text-[10px]">
                  <span class="text-slate-600 w-3">{isSource ? ">" : "<"}</span>
                  <span class="text-slate-500 w-14 shrink-0">{edge.label}</span>
                  <span
                    class="px-1 py-0.5 rounded {kindColors[otherNode?.kind ?? ''] ??
                      'text-slate-300'} text-[9px]">{otherNode?.kind}</span
                  >
                  <span class="text-slate-300 truncate">{otherNode?.name}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-[10px] text-amber-400">No connections - this resource is orphaned</p>
          {/if}
        </div>
      {/if}
    {:else}
      <p class="text-slate-500 italic text-center py-4">
        No data yet. Click Refresh to scan cluster resources.
      </p>
    {/if}
  </Card.Content>
</Card.Root>
