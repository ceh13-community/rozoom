<script lang="ts">
  /**
   * Compact traffic chain visualization for details sheets.
   *
   * Resolves and displays the resource dependency chain:
   *   Ingress -> Service -> Deployment/StatefulSet/DaemonSet -> Pod
   *
   * Resolution is based on:
   *   - Ingress spec.rules[].http.paths[].backend.service.name
   *   - Service spec.selector label matching against workload pod template labels
   *   - Pod metadata.ownerReferences
   */

  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

  type ChainNode = {
    kind: string;
    name: string;
    namespace: string;
    status?: "healthy" | "warning" | "error" | "unknown";
    count?: number;
  };

  type ChainLink = {
    from: ChainNode;
    to: ChainNode;
    label: string;
  };

  interface Props {
    clusterId: string;
    resourceKind: string;
    resourceName: string;
    resourceNamespace: string;
    raw: Record<string, unknown>;
  }

  const { clusterId, resourceKind, resourceName, resourceNamespace, raw }: Props = $props();

  let chain = $state<ChainLink[]>([]);
  let loading = $state(false);
  let resolved = $state(false);

  const kindColors: Record<string, string> = {
    Gateway: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    Ingress: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    Service: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    Endpoint: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    Deployment: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    StatefulSet: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    DaemonSet: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    ReplicaSet: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    Pod: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    PersistentVolumeClaim: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    PersistentVolume: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    StorageClass: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    ConfigMap: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    Secret: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    Job: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    CronJob: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    Node: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    Namespace: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    ServiceAccount: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  };

  const kindAbbr: Record<string, string> = {
    Gateway: "GW",
    Ingress: "ING",
    Service: "SVC",
    Endpoint: "EP",
    Deployment: "DEP",
    StatefulSet: "STS",
    DaemonSet: "DS",
    ReplicaSet: "RS",
    Pod: "POD",
    PersistentVolumeClaim: "PVC",
    PersistentVolume: "PV",
    StorageClass: "SC",
    ConfigMap: "CM",
    Secret: "SEC",
    Job: "JOB",
    CronJob: "CJ",
    Node: "NODE",
    Namespace: "NS",
    ServiceAccount: "SA",
  };

  async function kubectlJson(args: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await kubectlRawArgsFront(args.split(" "), { clusterId });
      if (result.errors || result.code !== 0) return null;
      return JSON.parse(result.output) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  }

  function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
  }

  async function resolveChain() {
    if (resolved || loading) return;
    loading = true;
    const links: ChainLink[] = [];

    try {
      const ns = resourceNamespace;
      const thisNode: ChainNode = { kind: resourceKind, name: resourceName, namespace: ns };

      if (resourceKind === "Ingress") {
        // Ingress -> Services
        const rules = asArray(asRecord(asRecord(raw).spec).rules);
        const serviceNames = new Set<string>();
        for (const rule of rules) {
          const paths = asArray(asRecord(asRecord(rule).http).paths);
          for (const path of paths) {
            const backend = asRecord(asRecord(path).backend);
            const svcName = String(asRecord(backend.service).name ?? "");
            if (svcName) serviceNames.add(svcName);
          }
        }
        // Also check defaultBackend
        const defaultBackend = asRecord(asRecord(asRecord(raw).spec).defaultBackend);
        const defaultSvc = String(asRecord(defaultBackend.service).name ?? "");
        if (defaultSvc) serviceNames.add(defaultSvc);

        for (const svcName of serviceNames) {
          const svcNode: ChainNode = { kind: "Service", name: svcName, namespace: ns };
          links.push({ from: thisNode, to: svcNode, label: "routes" });

          // Service -> Workloads
          const svcData = await kubectlJson(`get service ${svcName} -n ${ns} -o json`);
          if (svcData) {
            const svcLinks = await resolveServiceBackends(svcData, svcNode, ns);
            links.push(...svcLinks);
          }
        }
      } else if (resourceKind === "Gateway") {
        // Gateway API: find HTTPRoutes that reference this gateway
        const routes = await kubectlJson(`get httproutes -n ${ns} -o json`);
        for (const route of asArray(asRecord(routes ?? {}).items)) {
          const routeMeta = asRecord(asRecord(route).metadata);
          const routeName = String(routeMeta.name ?? "");
          const parentRefs = asArray(asRecord(asRecord(route).spec).parentRefs);
          const refsThisGw = parentRefs.some((ref) => String(asRecord(ref).name ?? "") === resourceName);
          if (!refsThisGw || !routeName) continue;
          const routeNode: ChainNode = { kind: "Ingress", name: routeName, namespace: ns };
          links.push({ from: thisNode, to: routeNode, label: "routes" });
          // HTTPRoute -> backends
          const routeLinks = await resolveHTTPRouteBackends(route, routeNode, ns);
          links.push(...routeLinks);
        }
      } else if (resourceKind === "HTTPRoute") {
        const routeLinks = await resolveHTTPRouteBackends(raw, thisNode, ns);
        links.push(...routeLinks);
      } else if (resourceKind === "Service" || resourceKind === "Endpoint") {
        const svcName = resourceKind === "Endpoint" ? resourceName : resourceName;
        const svcRaw = resourceKind === "Service" ? raw : await kubectlJson(`get service ${svcName} -n ${ns} -o json`);
        if (svcRaw) {
          const svcLinks = await resolveServiceBackends(svcRaw, thisNode, ns);
          links.push(...svcLinks);
        }
      } else if (["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet"].includes(resourceKind)) {
        const podLinks = await resolveWorkloadPods(resourceKind, resourceName, ns, thisNode);
        links.push(...podLinks);
      } else if (resourceKind === "Pod") {
        // Pod -> reverse lookup: owner + services pointing to this pod
        const podLabels = asRecord(asRecord(asRecord(raw).metadata).labels);
        const owners = asArray(asRecord(asRecord(raw).metadata).ownerReferences);
        for (const ref of owners) {
          const ownerKind = String(asRecord(ref).kind ?? "");
          const ownerName = String(asRecord(ref).name ?? "");
          if (ownerKind && ownerName) {
            links.push({ from: { kind: ownerKind, name: ownerName, namespace: ns }, to: thisNode, label: "owns" });
          }
        }
        // Find services whose selector matches this pod's labels
        if (Object.keys(podLabels).length > 0) {
          const svcs = await kubectlJson(`get services -n ${ns} -o json`);
          for (const svc of asArray(asRecord(svcs ?? {}).items)) {
            const selector = asRecord(asRecord(asRecord(svc).spec).selector);
            if (Object.keys(selector).length === 0) continue;
            const matches = Object.entries(selector).every(([k, v]) => podLabels[k] === v);
            if (matches) {
              const svcName = String(asRecord(asRecord(svc).metadata).name ?? "");
              if (svcName) links.push({ from: { kind: "Service", name: svcName, namespace: ns }, to: thisNode, label: "selects" });
            }
          }
        }
      } else if (resourceKind === "Job") {
        // Job -> owner CronJob + child pods
        const owners = asArray(asRecord(asRecord(raw).metadata).ownerReferences);
        for (const ref of owners) {
          const ownerKind = String(asRecord(ref).kind ?? "");
          const ownerName = String(asRecord(ref).name ?? "");
          if (ownerKind && ownerName) {
            links.push({ from: { kind: ownerKind, name: ownerName, namespace: ns }, to: thisNode, label: "owns" });
          }
        }
        const podLinks = await resolveWorkloadPods("Job", resourceName, ns, thisNode);
        links.push(...podLinks);
      } else if (resourceKind === "CronJob") {
        // CronJob -> jobs it created
        const jobs = await kubectlJson(`get jobs -n ${ns} -o json`);
        let jobCount = 0;
        for (const job of asArray(asRecord(jobs ?? {}).items)) {
          const refs = asArray(asRecord(asRecord(job).metadata).ownerReferences);
          const owned = refs.some((r) => String(asRecord(r).kind ?? "") === "CronJob" && String(asRecord(r).name ?? "") === resourceName);
          if (owned) jobCount++;
        }
        if (jobCount > 0) {
          links.push({ from: thisNode, to: { kind: "Job", name: `${jobCount} jobs`, namespace: ns, count: jobCount }, label: "creates" });
        }
      } else if (resourceKind === "Node") {
        // Node -> pods running on this node
        const pods = await kubectlJson(`get pods -A -o json --field-selector=spec.nodeName=${resourceName}`);
        const podItems = asArray(asRecord(pods ?? {}).items);
        let running = 0;
        for (const pod of podItems) {
          if (String(asRecord(asRecord(pod).status).phase ?? "") === "Running") running++;
        }
        if (podItems.length > 0) {
          links.push({ from: thisNode, to: { kind: "Pod", name: `${running}/${podItems.length}`, namespace: "all", count: podItems.length, status: running === podItems.length ? "healthy" : running > 0 ? "warning" : "error" }, label: "runs" });
        }
      } else if (resourceKind === "StorageClass") {
        // StorageClass -> PVCs using this class
        const pvcs = await kubectlJson(`get pvc -A -o json`);
        let pvcCount = 0;
        for (const pvc of asArray(asRecord(pvcs ?? {}).items)) {
          if (String(asRecord(asRecord(pvc).spec).storageClassName ?? "") === resourceName) pvcCount++;
        }
        if (pvcCount > 0) {
          links.push({ from: thisNode, to: { kind: "PersistentVolumeClaim", name: `${pvcCount} PVCs`, namespace: "all", count: pvcCount }, label: "provisions" });
        }
      } else if (resourceKind === "PersistentVolume") {
        // PV -> bound PVC
        const claimRef = asRecord(asRecord(asRecord(raw).spec).claimRef);
        const claimName = String(claimRef.name ?? "");
        const claimNs = String(claimRef.namespace ?? "");
        if (claimName) {
          links.push({ from: thisNode, to: { kind: "PersistentVolumeClaim", name: claimName, namespace: claimNs }, label: "bound to" });
        }
      } else if (resourceKind === "ServiceAccount") {
        // SA -> pods using this SA
        const pods = await kubectlJson(`get pods -n ${ns} -o json`);
        let podCount = 0;
        for (const pod of asArray(asRecord(pods ?? {}).items)) {
          if (String(asRecord(asRecord(pod).spec).serviceAccountName ?? "") === resourceName) podCount++;
        }
        if (podCount > 0) {
          links.push({ from: thisNode, to: { kind: "Pod", name: `${podCount} pods`, namespace: ns, count: podCount }, label: "used by" });
        }
      } else if (resourceKind === "Namespace") {
        // Namespace -> workload counts
        const [deps, stss, svcs, pods] = await Promise.all([
          kubectlJson(`get deployments -n ${resourceName} -o json`),
          kubectlJson(`get statefulsets -n ${resourceName} -o json`),
          kubectlJson(`get services -n ${resourceName} -o json`),
          kubectlJson(`get pods -n ${resourceName} -o json`),
        ]);
        const depCount = asArray(asRecord(deps ?? {}).items).length;
        const stsCount = asArray(asRecord(stss ?? {}).items).length;
        const svcCount = asArray(asRecord(svcs ?? {}).items).length;
        const podCount = asArray(asRecord(pods ?? {}).items).length;
        if (depCount > 0) links.push({ from: thisNode, to: { kind: "Deployment", name: `${depCount}`, namespace: resourceName, count: depCount }, label: "contains" });
        if (stsCount > 0) links.push({ from: thisNode, to: { kind: "StatefulSet", name: `${stsCount}`, namespace: resourceName, count: stsCount }, label: "contains" });
        if (svcCount > 0) links.push({ from: thisNode, to: { kind: "Service", name: `${svcCount}`, namespace: resourceName, count: svcCount }, label: "contains" });
        if (podCount > 0) links.push({ from: thisNode, to: { kind: "Pod", name: `${podCount}`, namespace: resourceName, count: podCount }, label: "contains" });
      } else if (resourceKind === "PersistentVolumeClaim" || resourceKind === "ConfigMap" || resourceKind === "Secret") {
        // Find pods that reference this resource via volumes or envFrom
        const pods = await kubectlJson(`get pods -n ${ns} -o json`);
        for (const pod of asArray(asRecord(pods ?? {}).items)) {
          const spec = asRecord(asRecord(pod).spec);
          let references = false;
          // Check volumes
          for (const vol of asArray(spec.volumes)) {
            if (resourceKind === "PersistentVolumeClaim" && String(asRecord(asRecord(vol).persistentVolumeClaim).claimName ?? "") === resourceName) references = true;
            if (resourceKind === "ConfigMap" && String(asRecord(asRecord(vol).configMap).name ?? "") === resourceName) references = true;
            if (resourceKind === "Secret" && String(asRecord(asRecord(vol).secret).secretName ?? "") === resourceName) references = true;
          }
          // Check envFrom in containers
          if (!references) {
            for (const container of asArray(spec.containers)) {
              for (const envFrom of asArray(asRecord(container).envFrom)) {
                if (resourceKind === "ConfigMap" && String(asRecord(asRecord(envFrom).configMapRef).name ?? "") === resourceName) references = true;
                if (resourceKind === "Secret" && String(asRecord(asRecord(envFrom).secretRef).name ?? "") === resourceName) references = true;
              }
            }
          }
          if (!references) continue;
          const podName = String(asRecord(asRecord(pod).metadata).name ?? "");
          if (podName) {
            links.push({ from: thisNode, to: { kind: "Pod", name: podName, namespace: ns }, label: "used by" });
          }
        }
      }
    } catch {
      // Silently handle errors
    } finally {
      chain = links;
      loading = false;
      resolved = true;
    }
  }

  function matchesSelector(item: unknown, selector: Record<string, string>): boolean {
    // Match against pod template labels (spec.template.metadata.labels)
    const templateLabels = asRecord(
      asRecord(asRecord(asRecord(asRecord(item).spec).template).metadata).labels,
    );
    return Object.entries(selector).every(([k, v]) => templateLabels[k] === v);
  }

  async function resolveServiceBackends(
    svcRaw: Record<string, unknown>,
    svcNode: ChainNode,
    ns: string,
  ): Promise<ChainLink[]> {
    const links: ChainLink[] = [];
    const selector = asRecord(asRecord(svcRaw).spec).selector as Record<string, string> | undefined;
    if (!selector || Object.keys(selector).length === 0) return links;

    // Fetch all workloads in namespace and match by pod template labels
    const [deps, stss, dss] = await Promise.all([
      kubectlJson(`get deployments -n ${ns} -o json`),
      kubectlJson(`get statefulsets -n ${ns} -o json`),
      kubectlJson(`get daemonsets -n ${ns} -o json`),
    ]);

    for (const dep of asArray(asRecord(deps ?? {}).items)) {
      if (!matchesSelector(dep, selector)) continue;
      const name = String(asRecord(asRecord(dep).metadata).name ?? "");
      if (!name) continue;
      const depNode: ChainNode = { kind: "Deployment", name, namespace: ns };
      links.push({ from: svcNode, to: depNode, label: "selects" });
      const podLinks = await resolveWorkloadPods("Deployment", name, ns, depNode);
      links.push(...podLinks);
    }

    for (const sts of asArray(asRecord(stss ?? {}).items)) {
      if (!matchesSelector(sts, selector)) continue;
      const name = String(asRecord(asRecord(sts).metadata).name ?? "");
      if (!name) continue;
      const stsNode: ChainNode = { kind: "StatefulSet", name, namespace: ns };
      links.push({ from: svcNode, to: stsNode, label: "selects" });
      const podLinks = await resolveWorkloadPods("StatefulSet", name, ns, stsNode);
      links.push(...podLinks);
    }

    for (const ds of asArray(asRecord(dss ?? {}).items)) {
      if (!matchesSelector(ds, selector)) continue;
      const name = String(asRecord(asRecord(ds).metadata).name ?? "");
      if (!name) continue;
      const dsNode: ChainNode = { kind: "DaemonSet", name, namespace: ns };
      links.push({ from: svcNode, to: dsNode, label: "selects" });
    }

    return links;
  }

  async function resolveWorkloadPods(
    ownerKind: string,
    ownerName: string,
    ns: string,
    parentNode: ChainNode,
  ): Promise<ChainLink[]> {
    const links: ChainLink[] = [];
    const pods = await kubectlJson(`get pods -n ${ns} -o json`);
    if (!pods) return links;

    let podCount = 0;
    let readyCount = 0;
    for (const pod of asArray(pods.items)) {
      const refs = asArray(asRecord(asRecord(pod).metadata).ownerReferences);
      const owned = refs.some((ref) => {
        const r = asRecord(ref);
        const refKind = String(r.kind ?? "");
        const refName = String(r.name ?? "");
        // Deployments own ReplicaSets, not Pods directly
        if (ownerKind === "Deployment") {
          return refKind === "ReplicaSet" && refName.startsWith(ownerName + "-");
        }
        return refKind === ownerKind && refName === ownerName;
      });
      if (!owned) continue;
      podCount++;
      const phase = String(asRecord(asRecord(pod).status).phase ?? "");
      if (phase === "Running") readyCount++;
    }

    if (podCount > 0) {
      links.push({
        from: parentNode,
        to: {
          kind: "Pod",
          name: `${readyCount}/${podCount} pods`,
          namespace: ns,
          count: podCount,
          status: readyCount === podCount ? "healthy" : readyCount > 0 ? "warning" : "error",
        },
        label: "owns",
      });
    }

    return links;
  }

  async function resolveHTTPRouteBackends(
    routeRaw: unknown,
    routeNode: ChainNode,
    ns: string,
  ): Promise<ChainLink[]> {
    const links: ChainLink[] = [];
    const rules = asArray(asRecord(asRecord(routeRaw).spec).rules);
    const serviceNames = new Set<string>();
    for (const rule of rules) {
      for (const ref of asArray(asRecord(rule).backendRefs)) {
        const name = String(asRecord(ref).name ?? "");
        if (name) serviceNames.add(name);
      }
    }
    for (const svcName of serviceNames) {
      const svcNode: ChainNode = { kind: "Service", name: svcName, namespace: ns };
      links.push({ from: routeNode, to: svcNode, label: "routes" });
      const svcData = await kubectlJson(`get service ${svcName} -n ${ns} -o json`);
      if (svcData) {
        const svcLinks = await resolveServiceBackends(svcData, svcNode, ns);
        links.push(...svcLinks);
      }
    }
    return links;
  }

  // Build flat display chain from links
  function buildDisplayNodes(): ChainNode[] {
    if (chain.length === 0) return [];
    const nodes: ChainNode[] = [];
    const seen = new Set<string>();

    function addNode(n: ChainNode) {
      const key = `${n.kind}/${n.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push(n);
    }

    // Start with source of first link
    if (chain[0]) addNode(chain[0].from);
    for (const link of chain) {
      addNode(link.to);
    }
    return nodes;
  }

  // Use untrack to avoid reactive loop: read props, write state
  let lastKey = "";
  $effect(() => {
    const key = `${resourceKind}/${resourceNamespace}/${resourceName}`;
    if (key === lastKey) return;
    lastKey = key;
    // Use queueMicrotask to break out of the reactive tracking context
    queueMicrotask(() => {
      resolved = false;
      chain = [];
      void resolveChain();
    });
  });
</script>

<div class="rounded border border-slate-700/50 bg-slate-900/30 p-3">
  <div class="mb-2 flex items-center justify-between">
    <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Traffic Chain</h4>
    {#if resolved && !loading}
      <button
        type="button"
        class="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        onclick={() => { resolved = false; void resolveChain(); }}
      >
        Refresh
      </button>
    {/if}
  </div>

  {#if loading}
    <div class="text-xs text-muted-foreground">Resolving traffic chain<LoadingDots /></div>
  {:else if chain.length === 0}
    <div class="text-xs text-muted-foreground">No related resources found.</div>
  {:else}
    <div class="flex flex-wrap items-center gap-1.5">
      {#each buildDisplayNodes() as node, i}
        {#if i > 0}
          <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
        {/if}
        <div class={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${kindColors[node.kind] ?? "bg-slate-500/20 text-slate-400 border-slate-500/30"}`}>
          <span class="font-bold">{kindAbbr[node.kind] ?? node.kind}</span>
          <span class="truncate max-w-[140px]" title={node.name}>{node.name}</span>
          {#if node.status === "healthy"}
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          {:else if node.status === "warning"}
            <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
          {:else if node.status === "error"}
            <span class="h-1.5 w-1.5 rounded-full bg-rose-400"></span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
