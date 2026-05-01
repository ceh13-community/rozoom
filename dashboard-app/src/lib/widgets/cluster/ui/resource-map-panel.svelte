<script lang="ts">
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Filter from "@lucide/svelte/icons/filter";
  import { Input } from "$shared/ui/input";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  type ChainNode = {
    kind: string;
    name: string;
    namespace: string;
    status?: "healthy" | "warning" | "error" | "unknown";
    count?: number;
  };

  type ResourceChain = {
    ingress?: ChainNode;
    services: ChainNode[];
    workloads: ChainNode[];
    pods: ChainNode[];
    configmaps: ChainNode[];
    secrets: ChainNode[];
    pvcs: ChainNode[];
  };

  type NamespaceGroup = {
    namespace: string;
    chains: ResourceChain[];
  };

  let loading = $state(false);
  let error = $state<string | null>(null);
  let groups = $state<NamespaceGroup[]>([]);
  let filterText = $state("");
  let filterNamespace = $state("all");
  let namespaces = $state<string[]>([]);
  let resolved = $state(false);

  const kindColors: Record<string, string> = {
    Gateway: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    Ingress: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    Service: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    Deployment: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    StatefulSet: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    DaemonSet: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    ReplicaSet: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    Pod: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    ConfigMap: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    Secret: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    PersistentVolumeClaim: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  };

  const kindAbbr: Record<string, string> = {
    Gateway: "GW", Ingress: "ING", Service: "SVC", Deployment: "DEP",
    StatefulSet: "STS", DaemonSet: "DS", ReplicaSet: "RS", Pod: "POD",
    ConfigMap: "CM", Secret: "SEC", PersistentVolumeClaim: "PVC",
  };

  function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  }
  function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
  }

  async function kubectlJson(args: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await kubectlRawArgsFront(args.split(" "), { clusterId });
      if (result.errors || result.code !== 0) return null;
      return JSON.parse(result.output) as Record<string, unknown>;
    } catch { return null; }
  }

  async function loadResourceMap() {
    loading = true;
    error = null;
    groups = [];
    try {
      // Fetch core resources in parallel
      const [svcData, depData, stsData, dsData, podData, ingData, cmData, secData, pvcData] = await Promise.all([
        kubectlJson("get services -A -o json"),
        kubectlJson("get deployments -A -o json"),
        kubectlJson("get statefulsets -A -o json"),
        kubectlJson("get daemonsets -A -o json"),
        kubectlJson("get pods -A -o json"),
        kubectlJson("get ingresses -A -o json"),
        kubectlJson("get configmaps -A -o json"),
        kubectlJson("get secrets -A -o json"),
        kubectlJson("get persistentvolumeclaims -A -o json"),
      ]);

      const services = asArray(asRecord(svcData ?? {}).items);
      const deployments = asArray(asRecord(depData ?? {}).items);
      const statefulsets = asArray(asRecord(stsData ?? {}).items);
      const daemonsets = asArray(asRecord(dsData ?? {}).items);
      const pods = asArray(asRecord(podData ?? {}).items);
      const ingresses = asArray(asRecord(ingData ?? {}).items);
      const configmaps = asArray(asRecord(cmData ?? {}).items);
      const secrets = asArray(asRecord(secData ?? {}).items);
      const pvcs = asArray(asRecord(pvcData ?? {}).items);

      // Build namespace set
      const nsSet = new Set<string>();
      for (const item of [...services, ...deployments, ...statefulsets, ...daemonsets]) {
        nsSet.add(String(asRecord(asRecord(item).metadata).namespace ?? "default"));
      }
      namespaces = [...nsSet].sort();

      // Build chains per service
      const nsGroups = new Map<string, ResourceChain[]>();

      for (const svc of services) {
        const meta = asRecord(asRecord(svc).metadata);
        const ns = String(meta.namespace ?? "default");
        const svcName = String(meta.name ?? "");
        const selector = asRecord(asRecord(asRecord(svc).spec).selector) as Record<string, string>;
        if (!svcName || Object.keys(selector).length === 0) continue;

        const chain: ResourceChain = {
          services: [{ kind: "Service", name: svcName, namespace: ns }],
          workloads: [],
          pods: [],
          configmaps: [],
          secrets: [],
          pvcs: [],
        };

        // Find ingresses pointing to this service
        for (const ing of ingresses) {
          const ingMeta = asRecord(asRecord(ing).metadata);
          if (String(ingMeta.namespace ?? "") !== ns) continue;
          const rules = asArray(asRecord(asRecord(ing).spec).rules);
          for (const rule of rules) {
            for (const path of asArray(asRecord(asRecord(rule).http).paths)) {
              const backendSvc = String(asRecord(asRecord(asRecord(path).backend).service).name ?? "");
              if (backendSvc === svcName) {
                chain.ingress = { kind: "Ingress", name: String(ingMeta.name ?? ""), namespace: ns };
              }
            }
          }
        }

        // Find workloads matching selector
        const matchesSelector = (item: unknown) => {
          const labels = asRecord(asRecord(asRecord(asRecord(asRecord(item).spec).template).metadata).labels);
          return Object.entries(selector).every(([k, v]) => labels[k] === v);
        };

        for (const dep of deployments) {
          const m = asRecord(asRecord(dep).metadata);
          if (String(m.namespace ?? "") !== ns) continue;
          if (matchesSelector(dep)) {
            chain.workloads.push({ kind: "Deployment", name: String(m.name ?? ""), namespace: ns });
          }
        }
        for (const sts of statefulsets) {
          const m = asRecord(asRecord(sts).metadata);
          if (String(m.namespace ?? "") !== ns) continue;
          if (matchesSelector(sts)) {
            chain.workloads.push({ kind: "StatefulSet", name: String(m.name ?? ""), namespace: ns });
          }
        }
        for (const ds of daemonsets) {
          const m = asRecord(asRecord(ds).metadata);
          if (String(m.namespace ?? "") !== ns) continue;
          if (matchesSelector(ds)) {
            chain.workloads.push({ kind: "DaemonSet", name: String(m.name ?? ""), namespace: ns });
          }
        }

        // Find pods matching selector
        let podReady = 0;
        let podTotal = 0;
        for (const pod of pods) {
          const podMeta = asRecord(asRecord(pod).metadata);
          if (String(podMeta.namespace ?? "") !== ns) continue;
          const podLabels = asRecord(podMeta.labels);
          const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
          if (!matches) continue;
          podTotal++;
          const phase = String(asRecord(asRecord(pod).status).phase ?? "");
          if (phase === "Running") podReady++;
        }
        if (podTotal > 0) {
          chain.pods.push({
            kind: "Pod",
            name: `${podReady}/${podTotal}`,
            namespace: ns,
            count: podTotal,
            status: podReady === podTotal ? "healthy" : podReady > 0 ? "warning" : "error",
          });
        }

        // Find ConfigMaps/Secrets/PVCs mounted by matching pods
        const mountedCMs = new Set<string>();
        const mountedSecs = new Set<string>();
        const mountedPVCs = new Set<string>();
        for (const pod of pods) {
          const podMeta = asRecord(asRecord(pod).metadata);
          if (String(podMeta.namespace ?? "") !== ns) continue;
          const podLabels = asRecord(podMeta.labels);
          const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
          if (!matches) continue;
          for (const vol of asArray(asRecord(asRecord(pod).spec).volumes)) {
            const cmName = String(asRecord(asRecord(vol).configMap).name ?? "");
            if (cmName) mountedCMs.add(cmName);
            const secName = String(asRecord(asRecord(vol).secret).secretName ?? "");
            if (secName) mountedSecs.add(secName);
            const pvcName = String(asRecord(asRecord(vol).persistentVolumeClaim).claimName ?? "");
            if (pvcName) mountedPVCs.add(pvcName);
          }
          // Also check envFrom
          for (const container of asArray(asRecord(asRecord(pod).spec).containers)) {
            for (const envFrom of asArray(asRecord(container).envFrom)) {
              const cmRef = String(asRecord(asRecord(envFrom).configMapRef).name ?? "");
              if (cmRef) mountedCMs.add(cmRef);
              const secRef = String(asRecord(asRecord(envFrom).secretRef).name ?? "");
              if (secRef) mountedSecs.add(secRef);
            }
          }
        }
        // Filter out default service account tokens
        for (const cm of mountedCMs) chain.configmaps.push({ kind: "ConfigMap", name: cm, namespace: ns });
        for (const sec of mountedSecs) {
          if (sec.includes("default-token") || sec.includes("kube-root-ca")) continue;
          chain.secrets.push({ kind: "Secret", name: sec, namespace: ns });
        }
        for (const pvc of mountedPVCs) chain.pvcs.push({ kind: "PersistentVolumeClaim", name: pvc, namespace: ns });

        if (!nsGroups.has(ns)) nsGroups.set(ns, []);
        nsGroups.get(ns)!.push(chain);
      }

      groups = [...nsGroups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([namespace, chains]) => ({ namespace, chains }));
      resolved = true;
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to build resource map.";
    } finally {
      loading = false;
    }
  }

  const filteredGroups = $derived.by(() => {
    let result = groups;
    if (filterNamespace !== "all") {
      result = result.filter((g) => g.namespace === filterNamespace);
    }
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      result = result.map((g) => ({
        ...g,
        chains: g.chains.filter((c) =>
          c.services.some((s) => s.name.toLowerCase().includes(q)) ||
          c.workloads.some((w) => w.name.toLowerCase().includes(q)) ||
          (c.ingress && c.ingress.name.toLowerCase().includes(q))
        ),
      })).filter((g) => g.chains.length > 0);
    }
    return result;
  });

  const totalChains = $derived(filteredGroups.reduce((sum, g) => sum + g.chains.length, 0));
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-3">
    <h2 class="text-lg font-bold">Resource Map</h2>
    <Button variant="outline" size="sm" onclick={() => void loadResourceMap()} disabled={loading}>
      <RefreshCw class={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {resolved ? "Refresh" : "Build Map"}
    </Button>
    {#if resolved}
      <span class="text-xs text-muted-foreground">{totalChains} service chains across {filteredGroups.length} namespaces</span>
    {/if}
  </div>

  <p class="text-xs text-muted-foreground">
    Full cluster resource dependency map. Shows traffic chains (Ingress -> Service -> Deployment -> Pod) and resource dependencies (ConfigMap, Secret, PVC) per service, grouped by namespace.
  </p>

  {#if error}
    <div class="rounded border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">{error}</div>
  {/if}

  {#if loading}
    <div class="rounded border p-6 text-center text-sm text-muted-foreground">
      Building resource map<LoadingDots />
    </div>
  {:else if !resolved}
    <div class="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
      Click "Build Map" to scan cluster resources and build the dependency graph.
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <Filter class="h-4 w-4 text-muted-foreground" />
      <select
        class="h-8 rounded border border-input bg-background px-2 text-xs"
        bind:value={filterNamespace}
      >
        <option value="all">All namespaces ({namespaces.length})</option>
        {#each namespaces as ns}
          <option value={ns}>{ns}</option>
        {/each}
      </select>
      <Input class="h-8 max-w-[240px] text-xs" placeholder="Filter by name..." bind:value={filterText} />
    </div>

    {#each filteredGroups as group}
      <div class="rounded border">
        <div class="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
          <span class="text-xs font-semibold">{group.namespace}</span>
          <span class="text-[10px] text-muted-foreground">{group.chains.length} chains</span>
        </div>
        <div class="divide-y">
          {#each group.chains as chain}
            <div class="flex flex-wrap items-center gap-1.5 px-3 py-2">
              <!-- Ingress -->
              {#if chain.ingress}
                <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors[chain.ingress.kind]}`}>
                  <span class="font-bold">{kindAbbr[chain.ingress.kind]}</span>
                  <span class="max-w-[100px] truncate" title={chain.ingress.name}>{chain.ingress.name}</span>
                </span>
                <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
              {/if}

              <!-- Services -->
              {#each chain.services as svc}
                <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors.Service}`}>
                  <span class="font-bold">SVC</span>
                  <span class="max-w-[100px] truncate" title={svc.name}>{svc.name}</span>
                </span>
              {/each}

              {#if chain.workloads.length > 0}
                <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
              {/if}

              <!-- Workloads -->
              {#each chain.workloads as wl}
                <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors[wl.kind]}`}>
                  <span class="font-bold">{kindAbbr[wl.kind]}</span>
                  <span class="max-w-[100px] truncate" title={wl.name}>{wl.name}</span>
                </span>
              {/each}

              {#if chain.pods.length > 0}
                <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
              {/if}

              <!-- Pods -->
              {#each chain.pods as pod}
                <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors.Pod}`}>
                  <span class="font-bold">POD</span>
                  <span>{pod.name}</span>
                  {#if pod.status === "healthy"}
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                  {:else if pod.status === "warning"}
                    <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                  {:else if pod.status === "error"}
                    <span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span>
                  {/if}
                </span>
              {/each}

              <!-- Mounted resources -->
              {#if chain.configmaps.length > 0 || chain.secrets.length > 0 || chain.pvcs.length > 0}
                <span class="ml-1 text-[10px] text-slate-600">|</span>
                {#each chain.configmaps as cm}
                  <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors.ConfigMap}`} title={cm.name}>
                    <span class="font-bold">CM</span>
                    <span class="max-w-[80px] truncate">{cm.name}</span>
                  </span>
                {/each}
                {#each chain.secrets as sec}
                  <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors.Secret}`} title={sec.name}>
                    <span class="font-bold">SEC</span>
                    <span class="max-w-[80px] truncate">{sec.name}</span>
                  </span>
                {/each}
                {#each chain.pvcs as pvc}
                  <span class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors.PersistentVolumeClaim}`} title={pvc.name}>
                    <span class="font-bold">PVC</span>
                    <span class="max-w-[80px] truncate">{pvc.name}</span>
                  </span>
                {/each}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}

    {#if filteredGroups.length === 0 && resolved}
      <div class="rounded border p-4 text-center text-sm text-muted-foreground">
        No chains match your filter.
      </div>
    {/if}
  {/if}
</div>
