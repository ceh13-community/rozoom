<script lang="ts">
  import {
    buildDependencyGraph,
    type DependencyGraph,
    type GraphNode,
    type GraphEdge,
  } from "./model";
  import { kubectlJson } from "$shared/api/kubectl-proxy";
  import * as Card from "$shared/ui/card";
  import * as Popover from "$shared/ui/popover";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import Info from "@lucide/svelte/icons/info";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  let graph = $state<DependencyGraph | null>(null);
  let selectedNode = $state<GraphNode | null>(null);
  let filterKind = $state<string>("all");
  let filterText = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let namespace = $state("all");
  let scannedAt = $state<number | null>(null);
  let tickMs = $state(Date.now());
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  function humanizeMapError(raw: string): { title: string; hint: string | null } {
    const lower = raw.toLowerCase();
    if (
      lower.includes("forbidden") ||
      lower.includes("unauthorized") ||
      lower.includes("system:unauthenticated")
    ) {
      return {
        title: "Permission denied while scanning resources",
        hint: "Your kubeconfig user lacks list rights on one or more: services, deployments, pods, ingresses, configmaps, secrets, pvcs, networkpolicies, hpas. Use a reader role with cluster-wide get/list.",
      };
    }
    if (
      lower.includes("connection refused") ||
      lower.includes("no route to host") ||
      lower.includes("econnrefused")
    ) {
      return {
        title: "Cluster API server unreachable",
        hint: "kubectl could not reach the API. Check cluster availability and kubeconfig context.",
      };
    }
    if (lower.includes("timeout") || lower.includes("deadline exceeded")) {
      return {
        title: "Scan timed out",
        hint: "Large clusters may exceed the default kubectl timeout. Try again, or narrow the scan to one namespace.",
      };
    }
    if (
      lower.includes("server doesn't have a resource type") ||
      lower.includes("no matches for kind")
    ) {
      return {
        title: "Missing resource types on this cluster",
        hint: "An expected API group is not installed. Scan continues but graph may be incomplete.",
      };
    }
    return { title: "Failed to build dependency graph", hint: null };
  }

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
      scannedAt = Date.now();
    } catch (e) {
      error = (e as Error).message;
    }
    loading = false;
  }

  $effect(() => {
    if (clusterId) void fetchResources();
  });

  $effect(() => {
    tickTimer = setInterval(() => {
      tickMs = Date.now();
    }, 10_000);
    return () => {
      if (tickTimer) clearInterval(tickTimer);
      tickTimer = null;
    };
  });

  const scannedAgoLabel = $derived.by(() => {
    if (!scannedAt) return null;
    const diff = Math.max(0, tickMs - scannedAt);
    const sec = Math.floor(diff / 1000);
    if (sec < 10) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  });

  const scannedStale = $derived.by(() => {
    if (!scannedAt) return false;
    return tickMs - scannedAt > 5 * 60 * 1000;
  });

  const humanizedError = $derived(error ? humanizeMapError(error) : null);

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function jumpToWorkload(node: GraphNode) {
    const params = new URLSearchParams($page.url.search);
    const map: Record<string, string> = {
      Deployment: "deployments",
      StatefulSet: "statefulsets",
      DaemonSet: "daemonsets",
      ReplicaSet: "replicasets",
      Pod: "pods",
      Service: "services",
      Ingress: "ingresses",
      ConfigMap: "configmaps",
      Secret: "secrets",
      PersistentVolumeClaim: "persistentvolumeclaims",
      ServiceAccount: "serviceaccounts",
      NetworkPolicy: "networkpolicies",
      HPA: "horizontalpodautoscalers",
    };
    const workload = map[node.kind];
    if (!workload) {
      toast.error(`No page for ${node.kind}`);
      return;
    }
    params.set("workload", workload);
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

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

  const filteredNodes = $derived.by(() => {
    const base = graph?.nodes ?? [];
    const byKind = filterKind === "all" ? base : base.filter((n) => n.kind === filterKind);
    const q = filterText.trim().toLowerCase();
    if (!q) return byKind;
    return byKind.filter(
      (n) => n.name.toLowerCase().includes(q) || n.namespace.toLowerCase().includes(q),
    );
  });

  const hasActiveFilter = $derived(filterKind !== "all" || filterText.trim().length > 0);

  const emptyStateCopy = $derived.by(() => {
    if (!graph) return "No data yet. Click Refresh to scan cluster resources.";
    if (graph.nodes.length === 0)
      return "This cluster has no scannable workload resources. Graph will populate once services, deployments, or pods exist.";
    if (hasActiveFilter)
      return "No resources match the current filter. Try clearing kind or search text.";
    return "No resources match.";
  });

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
        <input
          type="text"
          bind:value={filterText}
          placeholder="filter name"
          class="h-6 w-28 text-[10px] px-1.5 rounded border border-slate-600 bg-slate-900/50 text-slate-200 placeholder:text-slate-600"
        />
        <Popover.Root>
          <Popover.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                class="inline-flex h-6 items-center gap-1 rounded border border-slate-600 bg-slate-900/50 px-1.5 text-[10px] text-slate-300 hover:border-slate-400"
              >
                <Info class="h-3 w-3" /> Legend
              </button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-80 p-3 text-xs">
            <p class="font-semibold text-sm mb-2">Edge types</p>
            <div class="space-y-1.5 text-slate-400">
              <div>
                <span class="font-mono text-violet-400">routes-to</span> - Ingress routes HTTP traffic
                to Service
              </div>
              <div>
                <span class="font-mono text-sky-400">selects</span> - Service selects pods via label
                selector
              </div>
              <div>
                <span class="font-mono text-emerald-400">owns</span> - Workload owns pod replicas
              </div>
              <div>
                <span class="font-mono text-orange-400">mounts / uses</span> - Pod mounts ConfigMap or
                Secret (volume / envFrom)
              </div>
              <div>
                <span class="font-mono text-cyan-400">binds</span> - Pod binds PersistentVolumeClaim
              </div>
              <div><span class="font-mono text-pink-400">scales</span> - HPA scales a workload</div>
              <div>
                <span class="font-mono text-teal-400">secures</span> - NetworkPolicy applies to pods
              </div>
            </div>
            <p class="font-semibold text-sm mt-3 mb-2">Status dot</p>
            <div class="space-y-1 text-slate-400">
              <div>
                <span class="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1"></span> healthy
              </div>
              <div>
                <span class="inline-block h-2 w-2 rounded-full bg-amber-400 mr-1"></span> warning
              </div>
              <div>
                <span class="inline-block h-2 w-2 rounded-full bg-rose-400 mr-1"></span> error
              </div>
              <div>
                <span class="inline-block h-2 w-2 rounded-full bg-slate-500 mr-1"></span> unknown
              </div>
            </div>
          </Popover.Content>
        </Popover.Root>
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
    {#if error && humanizedError}
      <div
        class="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300"
      >
        <p class="font-semibold">{humanizedError.title}</p>
        {#if humanizedError.hint}
          <p class="text-[10px] text-rose-300/80 mt-0.5">{humanizedError.hint}</p>
        {/if}
        <details class="mt-1">
          <summary class="cursor-pointer text-[9px] text-rose-300/60">Raw error</summary>
          <pre class="mt-0.5 whitespace-pre-wrap text-[9px] text-rose-300/70">{error}</pre>
        </details>
      </div>
    {/if}

    {#if scannedAt && !loading}
      <div
        class="flex items-center gap-2 rounded border {scannedStale
          ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
          : 'border-slate-700 bg-slate-800/30 text-slate-400'} px-2 py-1 text-[10px]"
      >
        <span>Scanned {scannedAgoLabel}</span>
        {#if scannedStale}<span>- stale, consider refreshing</span>{/if}
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

      {#if filteredNodes.length === 0}
        <p class="text-slate-500 italic text-center py-4">{emptyStateCopy}</p>
      {/if}

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

          <div class="flex flex-wrap gap-1">
            {#if selectedNode}
              {@const sel = selectedNode}
              <button
                class="text-[10px] rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-700/40"
                onclick={() => jumpToWorkload(sel)}>Jump to {sel.kind} page</button
              >
              <button
                class="text-[10px] rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-700/40"
                onclick={() =>
                  copyText(
                    `kubectl describe ${sel.kind.toLowerCase()} ${sel.name} -n ${sel.namespace}`,
                    "describe command",
                  )}>Copy describe</button
              >
              <button
                class="text-[10px] rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-700/40"
                onclick={() =>
                  copyText(
                    `kubectl get ${sel.kind.toLowerCase()} ${sel.name} -n ${sel.namespace} -o yaml`,
                    "get -o yaml command",
                  )}>Copy get -o yaml</button
              >
              <button
                class="text-[10px] rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-700/40"
                onclick={() => copyText(`${sel.kind}/${sel.name} -n ${sel.namespace}`, "reference")}
                >Copy ref</button
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
      <p class="text-slate-500 italic text-center py-4">{emptyStateCopy}</p>
    {/if}
  </Card.Content>
</Card.Root>
