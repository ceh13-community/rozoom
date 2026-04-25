<script lang="ts">
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
  import { Button } from "$shared/ui/button";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Filter from "@lucide/svelte/icons/filter";
  import Info from "@lucide/svelte/icons/info";
  import Globe from "@lucide/svelte/icons/globe";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Input } from "$shared/ui/input";
  import * as Popover from "$shared/ui/popover";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";

  interface Props {
    clusterId: string;
  }

  const { clusterId }: Props = $props();

  type SvcPort = { port: number; name?: string; protocol?: string; targetPort?: string | number };

  type ChainNode = {
    kind: string;
    name: string;
    namespace: string;
    status?: "healthy" | "warning" | "error" | "unknown";
    count?: number;
    managedBy?: string;
    svcType?: string;
    ports?: SvcPort[];
    readyEndpoints?: number;
    lbIngress?: string[];
    ingressHosts?: string[];
    ingressClass?: string;
    pvcBound?: boolean;
    pvcCapacity?: string;
    exists?: boolean;
  };

  type ResourceChain = {
    ingress?: ChainNode;
    services: ChainNode[];
    workloads: ChainNode[];
    pods: ChainNode[];
    configmaps: ChainNode[];
    secrets: ChainNode[];
    pvcs: ChainNode[];
    isExternal: boolean;
    entryManagedBy?: string;
    orphanReasons: string[];
  };

  type ChainsGroup = {
    label: string;
    kind: "namespace" | "managed";
    chains: ResourceChain[];
  };

  let loading = $state(false);
  let loadingStep = $state<string | null>(null);
  let error = $state<string | null>(null);
  let groups = $state<ChainsGroup[]>([]);
  let filterText = $state("");
  let filterNamespace = $state("all");
  let filterKind = $state<
    "all" | "Ingress" | "Service" | "Deployment" | "StatefulSet" | "DaemonSet" | "Pod"
  >("all");
  let filterManaged = $state<"all" | "helm" | "argocd" | "flux" | "other" | "unmanaged">("all");
  let filterExternal = $state(false);
  let filterOrphans = $state(false);
  let groupBy = $state<"namespace" | "managed">("namespace");
  let collapsedGroups = $state<Set<string>>(new Set());
  let namespaces = $state<string[]>([]);
  let resolved = $state(false);
  let scannedAt = $state<number | null>(null);
  let showLegend = $state(false);
  let tickMs = $state(Date.now());
  let tickTimer: ReturnType<typeof setInterval> | null = null;

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
    Gateway: "GW",
    Ingress: "ING",
    Service: "SVC",
    Deployment: "DEP",
    StatefulSet: "STS",
    DaemonSet: "DS",
    ReplicaSet: "RS",
    Pod: "POD",
    ConfigMap: "CM",
    Secret: "SEC",
    PersistentVolumeClaim: "PVC",
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
    } catch {
      return null;
    }
  }

  function humanizeMapError(raw: string): { title: string; hint: string | null } {
    const lower = raw.toLowerCase();
    if (
      lower.includes("forbidden") ||
      lower.includes("unauthorized") ||
      lower.includes("system:unauthenticated")
    ) {
      return {
        title: "Permission denied while scanning resources",
        hint: "Your kubeconfig user lacks list rights on services, deployments, pods, ingresses, configmaps, secrets, pvcs, or endpoints. Use a reader role with cluster-wide get/list.",
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
        hint: "Large clusters may exceed the default 30s kubectl timeout. Try again, or narrow the scan to one namespace.",
      };
    }
    if (
      lower.includes("server doesn't have a resource type") ||
      lower.includes("no matches for kind")
    ) {
      return {
        title: "Missing resource types on this cluster",
        hint: "An expected API group (ingresses.networking.k8s.io / endpoints) is not installed. Scan continues but chains may be incomplete.",
      };
    }
    return { title: "Failed to build resource map", hint: null };
  }

  function extractManagedBy(item: unknown): string | undefined {
    const labels = asRecord(asRecord(asRecord(item).metadata).labels);
    const annots = asRecord(asRecord(asRecord(item).metadata).annotations);
    const mgr = String(labels["app.kubernetes.io/managed-by"] ?? "").toLowerCase();
    if (mgr === "helm") return "helm";
    if (mgr === "flux" || mgr === "kustomize-controller") return "flux";
    const argoAnnot = String(annots["argocd.argoproj.io/tracking-id"] ?? "");
    if (argoAnnot) return "argocd";
    if (labels["argocd.argoproj.io/instance"]) return "argocd";
    if (mgr) return "other";
    return undefined;
  }

  function extractSvcPorts(svc: unknown): SvcPort[] {
    const ports = asArray(asRecord(asRecord(svc).spec).ports);
    return ports.map((p) => {
      const r = asRecord(p);
      return {
        port: Number(r.port ?? 0),
        name: typeof r.name === "string" ? r.name : undefined,
        protocol: typeof r.protocol === "string" ? r.protocol : undefined,
        targetPort: r.targetPort as string | number | undefined,
      };
    });
  }

  function extractLbIngress(svc: unknown): string[] {
    const ing = asArray(asRecord(asRecord(asRecord(svc).status).loadBalancer).ingress);
    return ing
      .map((x) => {
        const r = asRecord(x);
        return String(r.ip ?? r.hostname ?? "");
      })
      .filter(Boolean);
  }

  function extractIngressHosts(ing: unknown): { hosts: string[]; tls: string[] } {
    const rules = asArray(asRecord(asRecord(ing).spec).rules);
    const hosts: string[] = [];
    for (const r of rules) {
      const h = String(asRecord(r).host ?? "");
      if (h) hosts.push(h);
    }
    const tlsEntries = asArray(asRecord(asRecord(ing).spec).tls);
    const tls: string[] = [];
    for (const t of tlsEntries) {
      for (const h of asArray(asRecord(t).hosts)) tls.push(String(h));
    }
    return { hosts, tls };
  }

  async function loadResourceMap() {
    loading = true;
    loadingStep =
      "Fetching cluster resources (services, workloads, pods, ingresses, endpoints, configmaps, secrets, pvcs)";
    error = null;
    groups = [];
    try {
      const [
        svcData,
        depData,
        stsData,
        dsData,
        podData,
        ingData,
        cmData,
        secData,
        pvcData,
        epData,
      ] = await Promise.all([
        kubectlJson("get services -A -o json"),
        kubectlJson("get deployments -A -o json"),
        kubectlJson("get statefulsets -A -o json"),
        kubectlJson("get daemonsets -A -o json"),
        kubectlJson("get pods -A -o json"),
        kubectlJson("get ingresses -A -o json"),
        kubectlJson("get configmaps -A -o json"),
        kubectlJson("get secrets -A -o json"),
        kubectlJson("get persistentvolumeclaims -A -o json"),
        kubectlJson("get endpoints -A -o json"),
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
      const endpoints = asArray(asRecord(epData ?? {}).items);

      // Index existing resources for orphan detection
      const cmIndex = new Set<string>();
      for (const cm of configmaps) {
        const m = asRecord(asRecord(cm).metadata);
        cmIndex.add(`${m.namespace}/${m.name}`);
      }
      const secIndex = new Set<string>();
      for (const s of secrets) {
        const m = asRecord(asRecord(s).metadata);
        secIndex.add(`${m.namespace}/${m.name}`);
      }
      const pvcIndex = new Map<string, { bound: boolean; capacity: string }>();
      for (const p of pvcs) {
        const m = asRecord(asRecord(p).metadata);
        const st = asRecord(asRecord(p).status);
        const cap = asRecord(st.capacity);
        pvcIndex.set(`${m.namespace}/${m.name}`, {
          bound: String(st.phase ?? "") === "Bound",
          capacity: String(cap.storage ?? ""),
        });
      }

      // Endpoints ready count per service
      const epReady = new Map<string, number>();
      for (const ep of endpoints) {
        const m = asRecord(asRecord(ep).metadata);
        const key = `${m.namespace}/${m.name}`;
        let ready = 0;
        for (const subset of asArray(asRecord(ep).subsets)) {
          ready += asArray(asRecord(subset).addresses).length;
        }
        epReady.set(key, ready);
      }

      loadingStep = "Building dependency chains";
      const nsSet = new Set<string>();
      for (const item of [...services, ...deployments, ...statefulsets, ...daemonsets]) {
        nsSet.add(String(asRecord(asRecord(item).metadata).namespace ?? "default"));
      }
      namespaces = [...nsSet].sort();

      const built: ResourceChain[] = [];

      for (const svc of services) {
        const meta = asRecord(asRecord(svc).metadata);
        const ns = String(meta.namespace ?? "default");
        const svcName = String(meta.name ?? "");
        const spec = asRecord(asRecord(svc).spec);
        const selector = asRecord(spec.selector) as Record<string, string>;
        if (!svcName) continue;
        const svcType = String(spec.type ?? "ClusterIP");
        const hasSelector = Object.keys(selector).length > 0;
        // Skip headless with no selector unless external (ExternalName)
        if (!hasSelector && svcType !== "ExternalName") continue;

        const ports = extractSvcPorts(svc);
        const lbIngress = extractLbIngress(svc);
        const readyEndpoints = epReady.get(`${ns}/${svcName}`) ?? 0;

        const chain: ResourceChain = {
          services: [
            {
              kind: "Service",
              name: svcName,
              namespace: ns,
              managedBy: extractManagedBy(svc),
              svcType,
              ports,
              readyEndpoints,
              lbIngress,
            },
          ],
          workloads: [],
          pods: [],
          configmaps: [],
          secrets: [],
          pvcs: [],
          isExternal: false,
          orphanReasons: [],
        };

        // Find ingresses pointing to this service
        for (const ing of ingresses) {
          const ingMeta = asRecord(asRecord(ing).metadata);
          if (String(ingMeta.namespace ?? "") !== ns) continue;
          const rules = asArray(asRecord(asRecord(ing).spec).rules);
          for (const rule of rules) {
            for (const path of asArray(asRecord(asRecord(rule).http).paths)) {
              const backendSvc = String(
                asRecord(asRecord(asRecord(path).backend).service).name ?? "",
              );
              if (backendSvc === svcName) {
                const ingSpec = asRecord(asRecord(ing).spec);
                const { hosts, tls } = extractIngressHosts(ing);
                const ingLb = extractLbIngress(ing);
                chain.ingress = {
                  kind: "Ingress",
                  name: String(ingMeta.name ?? ""),
                  namespace: ns,
                  managedBy: extractManagedBy(ing),
                  ingressHosts: hosts,
                  ingressClass:
                    typeof ingSpec.ingressClassName === "string"
                      ? ingSpec.ingressClassName
                      : undefined,
                  lbIngress: ingLb,
                };
                if (tls.length > 0)
                  chain.ingress.ingressClass = (chain.ingress.ingressClass ?? "") + " (TLS)";
              }
            }
          }
        }

        // External-facing flag + entry managed-by
        if (chain.ingress) {
          chain.isExternal = true;
          chain.entryManagedBy = chain.ingress.managedBy;
        } else if (
          svcType === "LoadBalancer" ||
          svcType === "NodePort" ||
          svcType === "ExternalName"
        ) {
          chain.isExternal = true;
          chain.entryManagedBy = chain.services[0]?.managedBy;
        } else {
          chain.entryManagedBy = chain.services[0]?.managedBy;
        }

        // Find workloads matching selector
        const matchesSelector = (item: unknown) => {
          const labels = asRecord(
            asRecord(asRecord(asRecord(asRecord(item).spec).template).metadata).labels,
          );
          return Object.entries(selector).every(([k, v]) => labels[k] === v);
        };

        if (hasSelector) {
          for (const dep of deployments) {
            const m = asRecord(asRecord(dep).metadata);
            if (String(m.namespace ?? "") !== ns) continue;
            if (matchesSelector(dep)) {
              chain.workloads.push({
                kind: "Deployment",
                name: String(m.name ?? ""),
                namespace: ns,
                managedBy: extractManagedBy(dep),
              });
            }
          }
          for (const sts of statefulsets) {
            const m = asRecord(asRecord(sts).metadata);
            if (String(m.namespace ?? "") !== ns) continue;
            if (matchesSelector(sts)) {
              chain.workloads.push({
                kind: "StatefulSet",
                name: String(m.name ?? ""),
                namespace: ns,
                managedBy: extractManagedBy(sts),
              });
            }
          }
          for (const ds of daemonsets) {
            const m = asRecord(asRecord(ds).metadata);
            if (String(m.namespace ?? "") !== ns) continue;
            if (matchesSelector(ds)) {
              chain.workloads.push({
                kind: "DaemonSet",
                name: String(m.name ?? ""),
                namespace: ns,
                managedBy: extractManagedBy(ds),
              });
            }
          }
        }

        // Find pods matching selector
        let podReady = 0;
        let podTotal = 0;
        if (hasSelector) {
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
        if (hasSelector) {
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
            for (const container of asArray(asRecord(asRecord(pod).spec).containers)) {
              for (const envFrom of asArray(asRecord(container).envFrom)) {
                const cmRef = String(asRecord(asRecord(envFrom).configMapRef).name ?? "");
                if (cmRef) mountedCMs.add(cmRef);
                const secRef = String(asRecord(asRecord(envFrom).secretRef).name ?? "");
                if (secRef) mountedSecs.add(secRef);
              }
            }
          }
        }
        for (const cm of mountedCMs) {
          const exists = cmIndex.has(`${ns}/${cm}`);
          chain.configmaps.push({ kind: "ConfigMap", name: cm, namespace: ns, exists });
          if (!exists) chain.orphanReasons.push(`ConfigMap '${cm}' referenced but missing`);
        }
        for (const sec of mountedSecs) {
          if (sec.includes("default-token") || sec.includes("kube-root-ca")) continue;
          const exists = secIndex.has(`${ns}/${sec}`);
          chain.secrets.push({ kind: "Secret", name: sec, namespace: ns, exists });
          if (!exists) chain.orphanReasons.push(`Secret '${sec}' referenced but missing`);
        }
        for (const pvc of mountedPVCs) {
          const info = pvcIndex.get(`${ns}/${pvc}`);
          chain.pvcs.push({
            kind: "PersistentVolumeClaim",
            name: pvc,
            namespace: ns,
            pvcBound: info?.bound ?? false,
            pvcCapacity: info?.capacity,
            exists: !!info,
          });
          if (info && !info.bound) chain.orphanReasons.push(`PVC '${pvc}' not Bound`);
          if (!info) chain.orphanReasons.push(`PVC '${pvc}' referenced but missing`);
        }

        // Orphan: selector but no workload
        if (hasSelector && chain.workloads.length === 0) {
          chain.orphanReasons.push("Service selector matches no workloads");
        }
        // Orphan: selector but zero pods backing
        if (hasSelector && readyEndpoints === 0 && podTotal === 0) {
          chain.orphanReasons.push("Service has 0 ready endpoints");
        }
        // Orphan: LoadBalancer without external IP
        if (svcType === "LoadBalancer" && lbIngress.length === 0) {
          chain.orphanReasons.push("LoadBalancer has no external IP/hostname yet");
        }

        built.push(chain);
      }

      // Group by chosen mode
      if (groupBy === "namespace") {
        const byNs = new Map<string, ResourceChain[]>();
        for (const c of built) {
          const ns = c.services[0]?.namespace ?? "default";
          if (!byNs.has(ns)) byNs.set(ns, []);
          byNs.get(ns)!.push(c);
        }
        groups = [...byNs.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, chains]) => ({ label, kind: "namespace" as const, chains }));
      } else {
        const byMgr = new Map<string, ResourceChain[]>();
        for (const c of built) {
          const key = c.entryManagedBy ?? "unmanaged";
          if (!byMgr.has(key)) byMgr.set(key, []);
          byMgr.get(key)!.push(c);
        }
        const order = ["helm", "argocd", "flux", "other", "unmanaged"];
        groups = [...byMgr.entries()]
          .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
          .map(([label, chains]) => ({ label, kind: "managed" as const, chains }));
      }
      resolved = true;
      scannedAt = Date.now();
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to build resource map.";
    } finally {
      loading = false;
      loadingStep = null;
    }
  }

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

  function jumpToWorkload(kind: string) {
    const params = new URLSearchParams($page.url.search);
    const map: Record<string, string> = {
      Deployment: "deployments",
      StatefulSet: "statefulsets",
      DaemonSet: "daemonsets",
      Pod: "pods",
      Service: "services",
      Ingress: "ingresses",
      ConfigMap: "configmaps",
      Secret: "secrets",
      PersistentVolumeClaim: "persistentvolumeclaims",
    };
    const workload = map[kind];
    if (!workload) {
      toast.error(`No page for ${kind}`);
      return;
    }
    params.set("workload", workload);
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function jumpToManagedPage(managedBy: string | undefined) {
    if (!managedBy) return;
    const params = new URLSearchParams($page.url.search);
    if (managedBy === "helm") params.set("workload", "helm");
    else if (managedBy === "argocd" || managedBy === "flux")
      params.set("workload", "gitopsbootstrap");
    else return;
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function chainToKubectl(chain: ResourceChain): string {
    const lines: string[] = [];
    if (chain.ingress) {
      lines.push(`kubectl get ingress ${chain.ingress.name} -n ${chain.ingress.namespace} -o yaml`);
    }
    for (const s of chain.services) {
      lines.push(`kubectl get service ${s.name} -n ${s.namespace} -o yaml`);
      lines.push(`kubectl get endpoints ${s.name} -n ${s.namespace}`);
    }
    for (const w of chain.workloads) {
      lines.push(`kubectl get ${w.kind.toLowerCase()} ${w.name} -n ${w.namespace} -o yaml`);
    }
    const ns = chain.services[0]?.namespace ?? "";
    const sel = chain.services[0];
    if (sel && ns) {
      lines.push(`kubectl get pods -n ${ns} -l <selector-from-service>  # inspect backing pods`);
    }
    for (const cm of chain.configmaps)
      lines.push(`kubectl get configmap ${cm.name} -n ${cm.namespace} -o yaml`);
    for (const s of chain.secrets) lines.push(`kubectl get secret ${s.name} -n ${s.namespace}`);
    for (const p of chain.pvcs) lines.push(`kubectl get pvc ${p.name} -n ${p.namespace}`);
    return lines.join("\n");
  }

  function toggleGroup(label: string) {
    const next = new Set(collapsedGroups);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    collapsedGroups = next;
  }

  function collapseAll() {
    collapsedGroups = new Set(filteredGroups.map((g) => g.label));
  }
  function expandAll() {
    collapsedGroups = new Set();
  }

  const filteredGroups = $derived.by(() => {
    let result = groups;
    if (groupBy === "namespace" && filterNamespace !== "all") {
      result = result.filter((g) => g.label === filterNamespace);
    }
    const applyPerChain = (pred: (c: ResourceChain) => boolean) =>
      (result = result
        .map((g) => ({ ...g, chains: g.chains.filter(pred) }))
        .filter((g) => g.chains.length > 0));
    if (filterKind !== "all") {
      const k = filterKind;
      applyPerChain((c) => {
        if (k === "Ingress") return !!c.ingress;
        if (k === "Service") return c.services.length > 0;
        if (k === "Pod") return c.pods.length > 0;
        return c.workloads.some((w) => w.kind === k);
      });
    }
    if (filterManaged !== "all") {
      const m = filterManaged;
      applyPerChain((c) => {
        const nodes = [c.ingress, ...c.services, ...c.workloads].filter(Boolean) as ChainNode[];
        if (m === "unmanaged") return nodes.every((n) => !n.managedBy);
        if (m === "other") return nodes.some((n) => n.managedBy === "other");
        return nodes.some((n) => n.managedBy === m);
      });
    }
    if (filterExternal) applyPerChain((c) => c.isExternal);
    if (filterOrphans) applyPerChain((c) => c.orphanReasons.length > 0);
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      applyPerChain(
        (c) =>
          c.services.some((s) => s.name.toLowerCase().includes(q)) ||
          c.workloads.some((w) => w.name.toLowerCase().includes(q)) ||
          (c.ingress && c.ingress.name.toLowerCase().includes(q)) ||
          (c.ingress?.ingressHosts?.some((h) => h.toLowerCase().includes(q)) ?? false),
      );
    }
    return result;
  });

  const totalChains = $derived(filteredGroups.reduce((sum, g) => sum + g.chains.length, 0));

  const hasActiveFilter = $derived(
    filterNamespace !== "all" ||
      filterKind !== "all" ||
      filterManaged !== "all" ||
      filterExternal ||
      filterOrphans ||
      filterText.trim().length > 0,
  );

  const emptyStateCopy = $derived.by(() => {
    if (!resolved)
      return 'Click "Build Map" to scan cluster resources and build the dependency graph.';
    if (groups.length === 0)
      return "This cluster has no services with selectors to chain. Map will populate once workloads are deployed.";
    if (hasActiveFilter) return "No chains match the current filter. Try clearing filters.";
    return "No chains found.";
  });

  const managedCounts = $derived.by(() => {
    const out = { helm: 0, argocd: 0, flux: 0, other: 0, unmanaged: 0 };
    for (const g of groups) {
      for (const c of g.chains) {
        const nodes = [c.ingress, ...c.services, ...c.workloads].filter(Boolean) as ChainNode[];
        const has = (m: string) => nodes.some((n) => n.managedBy === m);
        if (has("helm")) out.helm++;
        else if (has("argocd")) out.argocd++;
        else if (has("flux")) out.flux++;
        else if (has("other")) out.other++;
        else out.unmanaged++;
      }
    }
    return out;
  });

  const summaryCounts = $derived.by(() => {
    let external = 0;
    let orphans = 0;
    for (const g of groups) {
      for (const c of g.chains) {
        if (c.isExternal) external++;
        if (c.orphanReasons.length > 0) orphans++;
      }
    }
    return { external, orphans };
  });
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center gap-3">
    <h2 class="text-lg font-bold">Service Chains</h2>
    <Button variant="outline" size="sm" onclick={() => void loadResourceMap()} disabled={loading}>
      <RefreshCw class={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {resolved ? "Refresh" : "Build Chains"}
    </Button>
    {#if resolved}
      <span class="text-xs text-muted-foreground">
        {totalChains} chains / {filteredGroups.length}
        {groupBy === "namespace" ? "namespaces" : "groups"}
        {#if summaryCounts.external > 0}
          <span class="ml-2 text-sky-400">{summaryCounts.external} external</span>
        {/if}
        {#if summaryCounts.orphans > 0}
          <span class="ml-2 text-amber-400">{summaryCounts.orphans} with issues</span>
        {/if}
      </span>
    {/if}
  </div>

  <p class="text-xs text-muted-foreground">
    Linear per-Service chains grouped by namespace or manager: Ingress -&gt; Service -&gt; Workload
    -&gt; Pod, with mounted ConfigMaps/Secrets/PVCs. For an interactive graph view, switch to
    Workload Map.
  </p>

  {#if error && humanizedError}
    <div class="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
      <p class="font-semibold">{humanizedError.title}</p>
      {#if humanizedError.hint}
        <p class="text-[11px] text-rose-300/80 mt-1">{humanizedError.hint}</p>
      {/if}
      <details class="mt-2">
        <summary class="cursor-pointer text-[10px] text-rose-300/60">Raw error</summary>
        <pre class="mt-1 whitespace-pre-wrap text-[10px] text-rose-300/70">{error}</pre>
      </details>
    </div>
  {/if}

  {#if resolved && scannedAt && !loading}
    <div
      class="flex items-center gap-2 rounded border {scannedStale
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-300'
        : 'border-slate-700 bg-slate-800/30 text-slate-400'} px-3 py-1.5 text-[11px]"
    >
      <span>Scanned {scannedAgoLabel}</span>
      {#if scannedStale}
        <span class="text-amber-300">- stale, consider refreshing</span>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="rounded border p-6 text-center text-sm text-muted-foreground">
      {loadingStep ?? "Building chains"}<LoadingDots />
    </div>
  {:else if !resolved}
    <div class="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
      Click "Build Chains" to scan cluster resources and build per-Service dependency chains.
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <Filter class="h-4 w-4 text-muted-foreground" />
      <select
        class="h-8 rounded border border-input bg-background px-2 text-xs"
        bind:value={groupBy}
        onchange={() => void loadResourceMap()}
      >
        <option value="namespace">Group: namespace</option>
        <option value="managed">Group: managed-by</option>
      </select>
      {#if groupBy === "namespace"}
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterNamespace}
        >
          <option value="all">All namespaces ({namespaces.length})</option>
          {#each namespaces as ns}
            <option value={ns}>{ns}</option>
          {/each}
        </select>
      {/if}
      <select
        class="h-8 rounded border border-input bg-background px-2 text-xs"
        bind:value={filterKind}
      >
        <option value="all">All kinds</option>
        <option value="Ingress">Ingress only</option>
        <option value="Service">Service only</option>
        <option value="Deployment">Deployment</option>
        <option value="StatefulSet">StatefulSet</option>
        <option value="DaemonSet">DaemonSet</option>
        <option value="Pod">Has pods</option>
      </select>
      <select
        class="h-8 rounded border border-input bg-background px-2 text-xs"
        bind:value={filterManaged}
      >
        <option value="all">Any manager</option>
        <option value="helm">Helm ({managedCounts.helm})</option>
        <option value="argocd">ArgoCD ({managedCounts.argocd})</option>
        <option value="flux">Flux ({managedCounts.flux})</option>
        <option value="other">Other ({managedCounts.other})</option>
        <option value="unmanaged">Unmanaged ({managedCounts.unmanaged})</option>
      </select>
      <label class="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" class="h-3.5 w-3.5" bind:checked={filterExternal} />
        External-facing
      </label>
      <label class="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" class="h-3.5 w-3.5" bind:checked={filterOrphans} />
        Issues only
      </label>
      <Input
        class="h-8 max-w-[220px] text-xs"
        placeholder="Filter by name or host..."
        bind:value={filterText}
      />
      <Button variant="ghost" size="sm" onclick={collapseAll} class="h-8 text-xs"
        >Collapse all</Button
      >
      <Button variant="ghost" size="sm" onclick={expandAll} class="h-8 text-xs">Expand all</Button>
      <Popover.Root bind:open={showLegend}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class="inline-flex h-8 items-center gap-1 rounded border border-input bg-background px-2 text-xs hover:bg-muted"
            >
              <Info class="h-3.5 w-3.5" />
              Legend
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-80 p-3 text-xs">
          <p class="font-semibold text-sm mb-2">Edge legend</p>
          <div class="space-y-1.5">
            <div>
              <span class="font-mono text-violet-400">ING -&gt; SVC</span>
              <span class="text-slate-500">- Ingress routes HTTP traffic to Service</span>
            </div>
            <div>
              <span class="font-mono text-sky-400">SVC -&gt; DEP/STS/DS</span>
              <span class="text-slate-500">- Service selects workload pods via labels</span>
            </div>
            <div>
              <span class="font-mono text-emerald-400">WL -&gt; POD</span>
              <span class="text-slate-500">- Workload owns pod replicas</span>
            </div>
            <div>
              <span class="font-mono text-orange-400">POD -&gt; CM/SEC</span>
              <span class="text-slate-500">- Pod mounts config via volumes or envFrom</span>
            </div>
            <div>
              <span class="font-mono text-cyan-400">POD -&gt; PVC</span>
              <span class="text-slate-500">- Pod binds persistent storage</span>
            </div>
          </div>
          <p class="font-semibold text-sm mt-3 mb-2">Chain indicators</p>
          <div class="space-y-1.5 text-slate-400">
            <div>
              <span class="text-sky-400"><Globe class="inline h-3 w-3" /></span> = external-facing (Ingress
              / LoadBalancer / NodePort / ExternalName)
            </div>
            <div>
              <span class="text-amber-400"><TriangleAlert class="inline h-3 w-3" /></span> = chain has
              issues (missing CM/Secret, unbound PVC, 0 endpoints, no LB IP)
            </div>
          </div>
          <p class="font-semibold text-sm mt-3 mb-2">Pod status dot</p>
          <div class="space-y-1.5">
            <div>
              <span class="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1"></span> all pods Running
            </div>
            <div>
              <span class="inline-block h-2 w-2 rounded-full bg-amber-400 mr-1"></span> some pods Running
            </div>
            <div>
              <span class="inline-block h-2 w-2 rounded-full bg-rose-400 mr-1"></span> no pods Running
            </div>
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>

    {#snippet nodeBadge(node: ChainNode)}
      <Popover.Root>
        <Popover.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] hover:brightness-125 ${kindColors[node.kind] ?? ""} ${node.exists === false ? "border-dashed opacity-60" : ""}`}
              title={node.kind === "Service" && node.ports
                ? `${node.svcType ?? ""} ${node.ports.map((p) => `${p.port}${p.protocol ? "/" + p.protocol : ""}`).join(",")}`
                : `${node.kind}/${node.name}`}
            >
              <span class="font-bold">{kindAbbr[node.kind] ?? node.kind}</span>
              <span class="max-w-[120px] truncate">{node.name}</span>
              {#if node.kind === "Service" && typeof node.readyEndpoints === "number"}
                <span class="rounded bg-slate-900/60 px-1 text-[9px] text-slate-300"
                  >{node.readyEndpoints}ep</span
                >
              {/if}
              {#if node.kind === "PersistentVolumeClaim" && node.pvcBound === false}
                <span class="rounded bg-rose-500/20 px-1 text-[9px] text-rose-300">unbound</span>
              {/if}
              {#if node.exists === false}
                <span class="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">?</span>
              {/if}
              {#if node.managedBy === "helm"}
                <span class="rounded bg-violet-500/20 px-1 text-[9px] text-violet-300">helm</span>
              {:else if node.managedBy === "argocd"}
                <span class="rounded bg-sky-500/20 px-1 text-[9px] text-sky-300">argo</span>
              {:else if node.managedBy === "flux"}
                <span class="rounded bg-fuchsia-500/20 px-1 text-[9px] text-fuchsia-300">flux</span>
              {/if}
            </button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-72 p-2 text-xs">
          <p class="font-semibold truncate" title={node.name}>{node.kind} / {node.name}</p>
          <p class="text-[10px] text-slate-500 mb-2">ns: {node.namespace}</p>
          {#if node.kind === "Service" && node.ports && node.ports.length > 0}
            <p class="text-[10px] text-slate-400 mb-1">
              type: <span class="text-slate-200">{node.svcType}</span>
              {#if node.readyEndpoints != null}
                &middot; endpoints: <span class="text-slate-200">{node.readyEndpoints}</span>
              {/if}
            </p>
            <p class="text-[10px] text-slate-400 mb-2">
              ports: <span class="text-slate-200"
                >{node.ports
                  .map(
                    (p) =>
                      `${p.port}${p.protocol ? "/" + p.protocol : ""}${p.targetPort ? " -> " + p.targetPort : ""}${p.name ? " (" + p.name + ")" : ""}`,
                  )
                  .join(", ")}</span
              >
            </p>
            {#if node.lbIngress && node.lbIngress.length > 0}
              <p class="text-[10px] text-sky-400 mb-2">LB: {node.lbIngress.join(", ")}</p>
            {/if}
          {/if}
          {#if node.kind === "Ingress"}
            {#if node.ingressClass}
              <p class="text-[10px] text-slate-400 mb-1">
                class: <span class="text-slate-200">{node.ingressClass}</span>
              </p>
            {/if}
            {#if node.ingressHosts && node.ingressHosts.length > 0}
              <p class="text-[10px] text-slate-400 mb-2">
                hosts: <span class="text-slate-200">{node.ingressHosts.join(", ")}</span>
              </p>
            {/if}
            {#if node.lbIngress && node.lbIngress.length > 0}
              <p class="text-[10px] text-sky-400 mb-2">LB: {node.lbIngress.join(", ")}</p>
            {/if}
          {/if}
          {#if node.kind === "PersistentVolumeClaim"}
            <p class="text-[10px] text-slate-400 mb-2">
              {node.pvcBound ? "Bound" : "Not bound"}{node.pvcCapacity
                ? " / " + node.pvcCapacity
                : ""}
            </p>
          {/if}
          <div class="flex flex-col gap-1">
            <button
              class="text-left rounded px-2 py-1 hover:bg-muted"
              onclick={() => jumpToWorkload(node.kind)}>Jump to {node.kind} page</button
            >
            {#if node.managedBy === "helm"}
              <button
                class="text-left rounded px-2 py-1 hover:bg-muted text-violet-300"
                onclick={() => jumpToManagedPage("helm")}>Open Helm page</button
              >
            {:else if node.managedBy === "argocd" || node.managedBy === "flux"}
              <button
                class="text-left rounded px-2 py-1 hover:bg-muted text-sky-300"
                onclick={() => jumpToManagedPage(node.managedBy)}>Open GitOps page</button
              >
            {/if}
            <button
              class="text-left rounded px-2 py-1 hover:bg-muted"
              onclick={() =>
                copyText(
                  `kubectl describe ${node.kind.toLowerCase()} ${node.name} -n ${node.namespace}`,
                  "describe command",
                )}>Copy kubectl describe</button
            >
            <button
              class="text-left rounded px-2 py-1 hover:bg-muted"
              onclick={() =>
                copyText(
                  `kubectl get ${node.kind.toLowerCase()} ${node.name} -n ${node.namespace} -o yaml`,
                  "get -o yaml command",
                )}>Copy kubectl get -o yaml</button
            >
            <button
              class="text-left rounded px-2 py-1 hover:bg-muted"
              onclick={() =>
                copyText(`${node.kind}/${node.name} -n ${node.namespace}`, "reference")}
              >Copy reference</button
            >
          </div>
        </Popover.Content>
      </Popover.Root>
    {/snippet}

    {#each filteredGroups as group (group.label)}
      {@const collapsed = collapsedGroups.has(group.label)}
      <div class="rounded border">
        <button
          type="button"
          class="flex w-full items-center gap-2 border-b bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
          onclick={() => toggleGroup(group.label)}
        >
          {#if collapsed}
            <ChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
          {:else}
            <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
          {/if}
          <span class="text-xs font-semibold">
            {group.kind === "managed" && group.label === "unmanaged" ? "unmanaged" : group.label}
          </span>
          <span class="text-[10px] text-muted-foreground">{group.chains.length} chains</span>
        </button>
        {#if !collapsed}
          <div class="divide-y">
            {#each group.chains as chain, idx (idx)}
              <div
                class="flex flex-wrap items-center gap-1.5 px-3 py-2 {chain.isExternal
                  ? 'border-l-2 border-l-sky-500/50'
                  : ''}"
              >
                {#if chain.isExternal}
                  <span class="text-sky-400" title="External-facing entry point"
                    ><Globe class="h-3 w-3" /></span
                  >
                {/if}
                {#if chain.orphanReasons.length > 0}
                  <Popover.Root>
                    <Popover.Trigger>
                      {#snippet child({ props })}
                        <button {...props} class="text-amber-400" title="Chain has issues">
                          <TriangleAlert class="h-3 w-3" />
                        </button>
                      {/snippet}
                    </Popover.Trigger>
                    <Popover.Content class="w-72 p-2 text-xs">
                      <p class="font-semibold text-amber-300 mb-1">Chain issues</p>
                      <ul class="space-y-0.5 text-slate-300 text-[11px] list-disc pl-4">
                        {#each chain.orphanReasons as reason}
                          <li>{reason}</li>
                        {/each}
                      </ul>
                    </Popover.Content>
                  </Popover.Root>
                {/if}

                <!-- Ingress -->
                {#if chain.ingress}
                  {@render nodeBadge(chain.ingress)}
                  <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
                {/if}

                <!-- Services -->
                {#each chain.services as svc}
                  {@render nodeBadge(svc)}
                {/each}

                {#if chain.workloads.length > 0}
                  <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
                {/if}

                <!-- Workloads -->
                {#each chain.workloads as wl}
                  {@render nodeBadge(wl)}
                {/each}

                {#if chain.pods.length > 0}
                  <ArrowRight class="h-3 w-3 shrink-0 text-slate-600" />
                {/if}

                <!-- Pods -->
                {#each chain.pods as pod}
                  <span
                    class={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${kindColors.Pod}`}
                    title={`${pod.count ?? 0} pod(s), status ${pod.status}`}
                  >
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
                    {@render nodeBadge(cm)}
                  {/each}
                  {#each chain.secrets as sec}
                    {@render nodeBadge(sec)}
                  {/each}
                  {#each chain.pvcs as pvc}
                    {@render nodeBadge(pvc)}
                  {/each}
                {/if}

                <button
                  class="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                  title="Copy all kubectl get commands for this chain"
                  onclick={() => copyText(chainToKubectl(chain), "chain kubectl commands")}
                >
                  Export kubectl
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if filteredGroups.length === 0 && resolved}
      <div class="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
        {emptyStateCopy}
        {#if hasActiveFilter}
          <div class="mt-2">
            <Button
              variant="outline"
              size="sm"
              onclick={() => {
                filterNamespace = "all";
                filterKind = "all";
                filterManaged = "all";
                filterExternal = false;
                filterOrphans = false;
                filterText = "";
              }}
            >
              Clear filters
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
