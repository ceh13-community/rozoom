<script lang="ts">
  import { onMount } from "svelte";
  import { timeAgo, type NodeItem } from "$shared";
  import type { PageData } from "$entities/cluster";
  import {
    getLastHealthCheck,
    type ClusterHealthChecks,
    initWatchParsers,
  } from "$features/check-health";
  import {
    humanizeNodeCondition,
    TAINT_EFFECTS,
    type HumanizedNodeCondition,
  } from "$features/nodes-pressures/model/humanize";
  import {
    classifyNodeSeverity,
    SEVERITY_BADGE_CLASS,
    SEVERITY_LABEL,
    SEVERITY_RANK,
    type NodeSeverity,
  } from "$features/nodes-pressures/model/classify";
  import {
    detectFlapping,
    loadLastSnapshot,
    pushHistory,
    saveSnapshot,
    snapshotKey,
    type PressureSnapshot,
  } from "$features/nodes-pressures/model/history";
  import { Button } from "$shared/ui/button";
  import { Badge } from "$shared/ui/badge";
  import { Input } from "$shared/ui/input";
  import * as Popover from "$shared/ui/popover";
  import * as Alert from "$shared/ui/alert";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import Info from "@lucide/svelte/icons/info";
  import Refresh from "@lucide/svelte/icons/refresh-cw";
  import Download from "@lucide/svelte/icons/download";
  import Copy from "@lucide/svelte/icons/copy";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleX from "@lucide/svelte/icons/circle-x";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Zap from "@lucide/svelte/icons/zap";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";

  interface NodesPressuresListProps {
    data: PageData & { nodes?: NodeItem[] };
  }

  const { data }: NodesPressuresListProps = $props();

  type TabKey = "overview" | "nodes" | "conditions" | "taints";
  type FilterSeverity = "all" | NodeSeverity;
  type FilterCondition = "all" | "ready-false" | "memory" | "disk" | "pid" | "network";

  interface NodeConditionRow {
    type: string;
    status: string;
    reason: string;
    message: string;
    lastTransitionTime: string;
  }

  interface Taint {
    key: string;
    value: string;
    effect: string;
  }

  interface EnrichedNode {
    name: string;
    role: string;
    age: string;
    creationTimestamp: string;
    severity: NodeSeverity;
    ready: string;
    diskPressure: string;
    memoryPressure: string;
    pidPressure: string;
    networkUnavailable: string;
    conditions: NodeConditionRow[];
    humanized: HumanizedNodeCondition[];
    unschedulable: boolean;
    taints: Taint[];
    kubeletVersion: string;
    osImage: string;
    kernelVersion: string;
    containerRuntime: string;
    providerID: string;
    instanceType: string;
    capacity: { cpu: string; memory: string; storage: string };
    allocatable: { cpu: string; memory: string; storage: string };
    flappingTypes: string[];
  }

  let latestCheck: ClusterHealthChecks | null = $state(null);
  let rows = $state<EnrichedNode[]>([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let lastRefreshAt = $state<string | null>(null);

  let activeTab = $state<TabKey>("overview");
  let searchValue = $state("");
  let filterSeverity = $state<FilterSeverity>("all");
  let filterRole = $state("all");
  let filterCondition = $state<FilterCondition>("all");
  let filterTainted = $state(false);
  let filterCordoned = $state(false);

  const clusterSlug = $derived(data.slug);

  const ROLE_LABELS: Record<string, string> = {
    "node-role.kubernetes.io/control-plane": "control-plane",
    "node-role.kubernetes.io/master": "control-plane",
    "node-role.kubernetes.io/worker": "worker",
    "node-role.kubernetes.io/etcd": "etcd",
    "node-role.kubernetes.io/ingress": "ingress",
  };

  function deriveRole(labels: Record<string, string> | undefined, fallback: string): string {
    if (!labels) return fallback;
    for (const key of Object.keys(ROLE_LABELS)) {
      if (labels[key] !== undefined) return ROLE_LABELS[key];
    }
    return fallback || "worker";
  }

  function buildSnapshot(list: EnrichedNode[]): PressureSnapshot {
    const states: Record<string, string> = {};
    for (const n of list) {
      states[snapshotKey(n.name, "Ready")] = n.ready;
      states[snapshotKey(n.name, "DiskPressure")] = n.diskPressure;
      states[snapshotKey(n.name, "MemoryPressure")] = n.memoryPressure;
      states[snapshotKey(n.name, "PIDPressure")] = n.pidPressure;
      states[snapshotKey(n.name, "NetworkUnavailable")] = n.networkUnavailable;
    }
    return { takenAt: new Date().toISOString(), states };
  }

  let fetchedNodes = $state<NodeItem[] | null>(null);

  function buildEnriched(): EnrichedNode[] {
    const rawFromProps: NodeItem[] | undefined = data.nodes;
    if (Array.isArray(rawFromProps) && rawFromProps.length > 0) {
      return rawFromProps.map((n) => enrichFromRaw(n));
    }
    if (fetchedNodes && fetchedNodes.length > 0) {
      return fetchedNodes.map((n) => enrichFromRaw(n));
    }
    if (latestCheck?.nodes?.checks) {
      return latestCheck.nodes.checks.map((n) => enrichFromCheck(n));
    }
    return [];
  }

  async function fetchRawNodes(clusterId: string): Promise<NodeItem[] | null> {
    try {
      const res = await kubectlRawArgsFront(["get", "nodes", "-o", "json"], { clusterId });
      if (res.errors || res.code !== 0) return null;
      const parsed = JSON.parse(res.output) as { items?: NodeItem[] };
      return Array.isArray(parsed.items) ? parsed.items : null;
    } catch {
      return null;
    }
  }

  function enrichFromRaw(n: NodeItem): EnrichedNode {
    const cond = (type: string) => n.status.conditions?.find((c) => c.type === type)?.status ?? "-";
    const allConditions: NodeConditionRow[] = (n.status.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason ?? "",
      message: c.message ?? "",
      lastTransitionTime: c.lastTransitionTime ?? "",
    }));
    const ready = cond("Ready");
    const diskPressure = cond("DiskPressure");
    const memoryPressure = cond("MemoryPressure");
    const pidPressure = cond("PIDPressure");
    const networkUnavailable = cond("NetworkUnavailable");
    const unschedulable = Boolean(n.spec.unschedulable);
    const taints: Taint[] = Array.isArray(n.spec.taints)
      ? n.spec.taints.map((t) => ({ key: t.key, value: t.value, effect: t.effect }))
      : [];
    const labels = n.metadata.labels ?? {};
    const role = deriveRole(labels, "");
    const nodeInfo = n.status.nodeInfo as Record<string, unknown> | undefined;
    const kubeletVersion =
      typeof nodeInfo?.kubeletVersion === "string" ? nodeInfo.kubeletVersion : "";
    const osImage = typeof nodeInfo?.osImage === "string" ? nodeInfo.osImage : "";
    const kernelVersion = typeof nodeInfo?.kernelVersion === "string" ? nodeInfo.kernelVersion : "";
    const containerRuntime =
      typeof nodeInfo?.containerRuntimeVersion === "string" ? nodeInfo.containerRuntimeVersion : "";
    const providerID = n.spec.providerID ?? "";
    const instanceType =
      labels["node.kubernetes.io/instance-type"] ??
      labels["beta.kubernetes.io/instance-type"] ??
      "";

    const humanized: HumanizedNodeCondition[] = [];
    const flapping: string[] = [];
    for (const c of allConditions) {
      const problematic =
        (c.type === "Ready" && c.status !== "True") || (c.type !== "Ready" && c.status === "True");
      if (problematic) {
        humanized.push(humanizeNodeCondition(c.type, c.status, c.reason, c.message));
      }
      if (detectFlapping(clusterSlug, n.metadata.name, c.type)) {
        flapping.push(c.type);
      }
    }

    const severity = classifyNodeSeverity({
      ready,
      diskPressure,
      memoryPressure,
      pidPressure,
      networkUnavailable,
      unschedulable,
    });

    return {
      name: n.metadata.name,
      role,
      age: timeAgo(new Date(n.metadata.creationTimestamp)),
      creationTimestamp: String(n.metadata.creationTimestamp),
      severity,
      ready,
      diskPressure,
      memoryPressure,
      pidPressure,
      networkUnavailable,
      conditions: allConditions,
      humanized,
      unschedulable,
      taints,
      kubeletVersion,
      osImage,
      kernelVersion,
      containerRuntime,
      providerID,
      instanceType,
      capacity: {
        cpu: n.status.capacity?.cpu ?? "-",
        memory: n.status.capacity?.memory ?? "-",
        storage: n.status.capacity?.["ephemeral-storage"] ?? "-",
      },
      allocatable: {
        cpu: n.status.allocatable?.cpu ?? "-",
        memory: n.status.allocatable?.memory ?? "-",
        storage: n.status.allocatable?.["ephemeral-storage"] ?? "-",
      },
      flappingTypes: flapping,
    };
  }

  function enrichFromCheck(
    n: NonNullable<ClusterHealthChecks["nodes"]>["checks"][number],
  ): EnrichedNode {
    const cond = (type: string) => n.status.conditions?.find((c) => c.type === type)?.status ?? "-";
    const allConditions: NodeConditionRow[] = (n.status.conditions ?? []).map((c) => ({
      type: c.type,
      status: c.status,
      reason: c.reason ?? "",
      message: c.message ?? "",
      lastTransitionTime: c.lastTransitionTime ?? "",
    }));
    const ready = cond("Ready");
    const diskPressure = cond("DiskPressure");
    const memoryPressure = cond("MemoryPressure");
    const pidPressure = cond("PIDPressure");
    const networkUnavailable = cond("NetworkUnavailable");

    const humanized: HumanizedNodeCondition[] = [];
    for (const c of allConditions) {
      const problematic =
        (c.type === "Ready" && c.status !== "True") || (c.type !== "Ready" && c.status === "True");
      if (problematic) {
        humanized.push(humanizeNodeCondition(c.type, c.status, c.reason, c.message));
      }
    }
    const severity = classifyNodeSeverity({
      ready,
      diskPressure,
      memoryPressure,
      pidPressure,
      networkUnavailable,
    });
    return {
      name: n.metadata.name,
      role: n.role ?? "worker",
      age: timeAgo(new Date(n.metadata.creationTimestamp)),
      creationTimestamp: String(n.metadata.creationTimestamp),
      severity,
      ready,
      diskPressure,
      memoryPressure,
      pidPressure,
      networkUnavailable,
      conditions: allConditions,
      humanized,
      unschedulable: false,
      taints: [],
      kubeletVersion: "",
      osImage: "",
      kernelVersion: "",
      containerRuntime: "",
      providerID: "",
      instanceType: "",
      capacity: { cpu: "-", memory: "-", storage: "-" },
      allocatable: { cpu: "-", memory: "-", storage: "-" },
      flappingTypes: [],
    };
  }

  async function refreshNodePressures() {
    refreshing = true;
    try {
      const needsRawFetch = !Array.isArray(data.nodes) || data.nodes.length === 0;
      const [nextCheck, raw] = await Promise.all([
        getLastHealthCheck(clusterSlug),
        needsRawFetch ? fetchRawNodes(clusterSlug) : Promise.resolve(null),
      ]);
      latestCheck = nextCheck && !("errors" in nextCheck) ? nextCheck : null;
      if (raw) fetchedNodes = raw;
      const built = buildEnriched();
      rows = built.sort((a, b) => {
        const diff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name);
      });
      const snap = buildSnapshot(built);
      saveSnapshot(clusterSlug, snap);
      pushHistory(clusterSlug, snap);
      lastRefreshAt = new Date().toISOString();
    } finally {
      refreshing = false;
    }
  }

  onMount(async () => {
    initWatchParsers();
    await refreshNodePressures();
    loading = false;
  });

  $effect(() => {
    if (!latestCheck && !data.nodes) return;
    const built = buildEnriched();
    rows = built.sort((a, b) => {
      const diff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });
  });

  const allRoles = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.role || "-");
    return [...set].sort();
  });

  const filteredRows = $derived.by(() => {
    const q = searchValue.trim().toLowerCase();
    return rows.filter((n) => {
      if (filterSeverity !== "all" && n.severity !== filterSeverity) return false;
      if (filterRole !== "all" && n.role !== filterRole) return false;
      if (filterTainted && n.taints.length === 0) return false;
      if (filterCordoned && !n.unschedulable) return false;
      if (filterCondition !== "all") {
        const map: Record<FilterCondition, () => boolean> = {
          all: () => true,
          "ready-false": () => n.ready !== "True",
          memory: () => n.memoryPressure === "True",
          disk: () => n.diskPressure === "True",
          pid: () => n.pidPressure === "True",
          network: () => n.networkUnavailable === "True",
        };
        if (!map[filterCondition]()) return false;
      }
      if (!q) return true;
      return [n.name, n.role, n.instanceType, n.kubeletVersion, n.osImage, n.providerID].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    });
  });

  const counts = $derived.by(() => {
    const out = {
      total: rows.length,
      healthy: 0,
      warning: 0,
      critical: 0,
      cordoned: 0,
      notReady: 0,
      tainted: 0,
      flapping: 0,
    };
    for (const n of rows) {
      out[n.severity]++;
      if (n.ready !== "True") out.notReady++;
      if (n.taints.length > 0) out.tainted++;
      if (n.flappingTypes.length > 0) out.flapping++;
    }
    return out;
  });

  const byRole = $derived.by(() => {
    const map = new Map<string, number>();
    for (const n of rows) map.set(n.role, (map.get(n.role) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  });

  const topOffenders = $derived.by(() =>
    rows
      .filter((n) => n.severity === "critical" || n.severity === "warning")
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
      .slice(0, 5),
  );

  const byCondition = $derived.by(() => {
    const groups = new Map<string, EnrichedNode[]>();
    const add = (key: string, n: EnrichedNode) => {
      const list = groups.get(key) ?? [];
      list.push(n);
      groups.set(key, list);
    };
    for (const n of rows) {
      if (n.ready !== "True") add("Ready = False (NotReady)", n);
      if (n.memoryPressure === "True") add("MemoryPressure", n);
      if (n.diskPressure === "True") add("DiskPressure", n);
      if (n.pidPressure === "True") add("PIDPressure", n);
      if (n.networkUnavailable === "True") add("NetworkUnavailable", n);
    }
    return [...groups.entries()].map(([title, nodes]) => ({ title, nodes }));
  });

  const taintedNodes = $derived(rows.filter((n) => n.taints.length > 0 || n.unschedulable));

  function formatDate(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  const UNIT_BINARY: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  const UNIT_DECIMAL: Record<string, number> = {
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
  };

  function parseK8sQuantityBytes(raw: string | undefined | null): number | null {
    if (!raw || raw === "-") return null;
    const value = String(raw).trim();
    const match = value.match(/^(\d+(?:\.\d+)?)([a-zA-Z]*)$/);
    if (!match) return null;
    const n = Number.parseFloat(match[1]);
    if (!Number.isFinite(n)) return null;
    const suffix = match[2];
    if (!suffix) return n;
    if (UNIT_BINARY[suffix]) return n * UNIT_BINARY[suffix];
    if (UNIT_DECIMAL[suffix]) return n * UNIT_DECIMAL[suffix];
    return null;
  }

  function formatBytes(bytes: number | null): string {
    if (bytes == null) return "-";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(2)} ${units[i]}`;
  }

  function formatK8sMemory(raw: string | undefined | null): string {
    const bytes = parseK8sQuantityBytes(raw);
    if (bytes == null) return raw && raw !== "-" ? raw : "-";
    return formatBytes(bytes);
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function copyCordon(n: EnrichedNode) {
    copyText(`kubectl cordon ${n.name}`, "cordon command");
  }
  function copyUncordon(n: EnrichedNode) {
    copyText(`kubectl uncordon ${n.name}`, "uncordon command");
  }
  function copyDrain(n: EnrichedNode) {
    copyText(
      `# WARNING: drain evicts all pods (respecting PDB + terminationGracePeriod).\nkubectl drain ${n.name} --ignore-daemonsets --delete-emptydir-data --grace-period=30`,
      "drain command (review flags before running)",
    );
  }
  function copyDescribe(n: EnrichedNode) {
    copyText(`kubectl describe node ${n.name}`, "describe node command");
  }
  function copyEvents(n: EnrichedNode) {
    copyText(
      `kubectl get events -A --field-selector=involvedObject.name=${n.name} --sort-by=.lastTimestamp`,
      "events query",
    );
  }
  function copyPodsOnNode(n: EnrichedNode) {
    copyText(
      `kubectl get pods -A --field-selector=spec.nodeName=${n.name} -o wide`,
      "pods-on-node query",
    );
  }
  function copyTopNode(n: EnrichedNode) {
    copyText(`kubectl top node ${n.name}`, "top node command");
  }
  function jumpToNodes(n: EnrichedNode) {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "nodesstatus");
    void goto(`?${params.toString()}`, { keepFocus: false });
    void n;
  }
  function gotoAlerts() {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "alertshub");
    void goto(`?${params.toString()}`, { keepFocus: false });
  }
  function gotoMetricsSources() {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "metricssources");
    void goto(`?${params.toString()}`, { keepFocus: false });
  }
  function clearFilters() {
    searchValue = "";
    filterSeverity = "all";
    filterRole = "all";
    filterCondition = "all";
    filterTainted = false;
    filterCordoned = false;
  }
  function exportCsv() {
    if (filteredRows.length === 0) {
      toast.info("No rows to export");
      return;
    }
    const header = [
      "severity",
      "name",
      "role",
      "ready",
      "memoryPressure",
      "diskPressure",
      "pidPressure",
      "networkUnavailable",
      "unschedulable",
      "taints",
      "kubeletVersion",
      "osImage",
      "instanceType",
      "capacityCPU",
      "capacityMemory",
      "flapping",
    ];
    const body = filteredRows.map((n) => [
      n.severity,
      n.name,
      n.role,
      n.ready,
      n.memoryPressure,
      n.diskPressure,
      n.pidPressure,
      n.networkUnavailable,
      String(n.unschedulable),
      n.taints.map((t) => `${t.key}=${t.value}:${t.effect}`).join(";"),
      n.kubeletVersion,
      n.osImage,
      n.instanceType,
      n.capacity.cpu,
      formatK8sMemory(n.capacity.memory),
      n.flappingTypes.join(";"),
    ]);
    const csv = [header, ...body]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nodes-pressures-${clusterSlug}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Initialize snapshot history for flapping detection on first load
  onMount(() => {
    const last = loadLastSnapshot(clusterSlug);
    void last;
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <h2 class="text-lg font-semibold">Nodes Pressures</h2>
      {#if counts.critical > 0}
        <Badge class="bg-rose-600 text-white">{counts.critical} critical</Badge>
      {/if}
      {#if counts.warning > 0}
        <Badge class="bg-amber-500 text-white">{counts.warning} warning</Badge>
      {/if}
      {#if counts.flapping > 0}
        <Badge class="bg-fuchsia-500 text-white">
          <Zap class="mr-1 h-3 w-3" />
          {counts.flapping} flapping
        </Badge>
      {/if}
      <Popover.Root>
        <Popover.Trigger>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="About node pressures"
            title="About node pressures"
          >
            <Info class="h-4 w-4" />
          </Button>
        </Popover.Trigger>
        <Popover.Content class="w-[520px] space-y-3" sideOffset={8}>
          <p class="text-sm font-semibold text-foreground">What "pressure" means</p>
          <p class="text-xs text-muted-foreground">
            Kubelet advertises four pressure conditions when the node is close to resource
            exhaustion. When a pressure is True, kubelet starts evicting pods (by QoS class) and the
            scheduler avoids placing new pods there.
          </p>
          <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
            <li><code>MemoryPressure</code> - available memory &lt; 100Mi (default)</li>
            <li><code>DiskPressure</code> - free inodes &lt; 5% or free space &lt; 10%</li>
            <li><code>PIDPressure</code> - available PIDs running low</li>
            <li><code>NetworkUnavailable</code> - CNI has not configured node networking</li>
            <li><code>Ready=False</code> - control plane hasn't seen a heartbeat</li>
          </ul>
          <p class="text-sm font-semibold text-foreground">Related alert rules</p>
          <ul class="space-y-0.5 text-xs text-muted-foreground list-disc pl-4">
            <li>NodeFilesystemAlmostOutOfSpace / SpaceFillingUp</li>
            <li>NodeHighNumberConntrack</li>
            <li>KubeNodeNotReady / KubeNodeUnreachable</li>
          </ul>
          <p class="text-xs text-muted-foreground">
            Taints and the <code>unschedulable</code> flag separately control whether new pods can land
            here - a tainted/cordoned node is not "pressured", just closed for business.
          </p>
        </Popover.Content>
      </Popover.Root>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={refreshNodePressures}
        loading={refreshing}
        loadingLabel="Refreshing"
      >
        <Refresh class="mr-2 h-3.5 w-3.5" /> Refresh
      </Button>
      <Button variant="outline" size="sm" onclick={exportCsv} disabled={filteredRows.length === 0}>
        <Download class="mr-2 h-3.5 w-3.5" /> Export CSV
      </Button>
      <Button variant="ghost" size="sm" onclick={gotoAlerts} title="Related alerts">
        <ExternalLink class="mr-2 h-3.5 w-3.5" /> Alerts Hub
      </Button>
      <Button variant="ghost" size="sm" onclick={gotoMetricsSources} title="Metrics Sources Status">
        <ExternalLink class="mr-2 h-3.5 w-3.5" /> Metrics Sources
      </Button>
    </div>
  </div>

  <div class="flex items-center gap-1 border-b border-border">
    {#each [{ k: "overview", label: "Overview" }, { k: "nodes", label: "Nodes" }, { k: "conditions", label: "Conditions" }, { k: "taints", label: "Taints" }] as tab (tab.k)}
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = tab.k as TabKey)}
      >
        {tab.label}
        {#if tab.k === "nodes" && rows.length > 0}
          <span class="ml-1 text-[10px] text-muted-foreground">({rows.length})</span>
        {/if}
        {#if tab.k === "conditions" && byCondition.length > 0}
          <span class="ml-1 text-[10px] text-rose-400">({byCondition.length})</span>
        {/if}
        {#if tab.k === "taints" && taintedNodes.length > 0}
          <span class="ml-1 text-[10px] text-muted-foreground">({taintedNodes.length})</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="px-4 py-6 text-sm text-muted-foreground">
      Loading node pressures<LoadingDots />
    </div>
  {:else if rows.length === 0}
    <TableEmptyState
      message="No nodes visible. Check kubeconfig RBAC (list nodes) or cluster connectivity."
    />
  {:else}
    {#if activeTab === "overview"}
      <div class="grid gap-3 md:grid-cols-5">
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Total nodes</p>
          <p class="text-2xl font-mono font-bold">{counts.total}</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Healthy</p>
          <p class="text-2xl font-mono font-bold text-emerald-400">{counts.healthy}</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Warning</p>
          <p class="text-2xl font-mono font-bold {counts.warning > 0 ? 'text-amber-400' : ''}">
            {counts.warning}
          </p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Critical</p>
          <p class="text-2xl font-mono font-bold {counts.critical > 0 ? 'text-rose-400' : ''}">
            {counts.critical}
          </p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Cordoned</p>
          <p class="text-2xl font-mono font-bold text-slate-400">{counts.cordoned}</p>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-3">
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">NotReady</p>
          <p class="text-lg font-mono {counts.notReady > 0 ? 'text-rose-400' : ''}">
            {counts.notReady}
          </p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Tainted nodes</p>
          <p class="text-lg font-mono">{counts.tainted}</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Flapping (last {rows.length ? 5 : 0} refreshes)</p>
          <p class="text-lg font-mono {counts.flapping > 0 ? 'text-fuchsia-400' : ''}">
            {counts.flapping}
          </p>
        </div>
      </div>

      {#if byRole.length > 0}
        <div class="rounded border border-border p-3 space-y-1">
          <p class="text-xs font-semibold">By role</p>
          <div class="flex flex-wrap gap-2 text-[11px]">
            {#each byRole as [role, n]}
              <span class="rounded border border-border px-2 py-0.5 text-muted-foreground">
                {role || "(none)"}:
                <span class="font-mono text-foreground">{n}</span>
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if topOffenders.length > 0}
        <Alert.Root variant="default">
          <Alert.Title>Top offenders ({topOffenders.length})</Alert.Title>
          <Alert.Description>
            <ul class="mt-2 space-y-1.5 text-xs">
              {#each topOffenders as n (n.name)}
                <li class="flex flex-wrap items-center gap-2">
                  <Badge class="text-white {SEVERITY_BADGE_CLASS[n.severity]}">
                    {SEVERITY_LABEL[n.severity]}
                  </Badge>
                  <span class="font-mono">{n.name}</span>
                  <span class="text-muted-foreground">- {n.role}</span>
                  {#each n.humanized as h}
                    <span class="text-[10px] text-amber-400">- {h.title}</span>
                  {/each}
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 ml-auto text-[10px]"
                    onclick={() => copyDescribe(n)}
                  >
                    <Copy class="mr-1 h-3 w-3" /> describe
                  </Button>
                </li>
              {/each}
            </ul>
          </Alert.Description>
        </Alert.Root>
      {/if}

      <p class="text-xs text-muted-foreground">
        Last refresh: {formatDate(lastRefreshAt)}. Flapping is computed from the last 5 manual
        refreshes (persisted locally).
      </p>
    {/if}

    {#if activeTab === "nodes"}
      <div class="flex flex-wrap items-center gap-2">
        <Input
          class="h-8 max-w-[240px] text-xs"
          placeholder="Search name, role, version..."
          bind:value={searchValue}
        />
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterSeverity}
        >
          <option value="all">Any severity</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="cordoned">Cordoned</option>
          <option value="healthy">Healthy</option>
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterRole}
        >
          <option value="all">Any role ({allRoles.length})</option>
          {#each allRoles as role}
            <option value={role}>{role || "(none)"}</option>
          {/each}
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterCondition}
        >
          <option value="all">Any condition</option>
          <option value="ready-false">NotReady</option>
          <option value="memory">MemoryPressure</option>
          <option value="disk">DiskPressure</option>
          <option value="pid">PIDPressure</option>
          <option value="network">NetworkUnavailable</option>
        </select>
        <label class="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" class="h-3.5 w-3.5" bind:checked={filterTainted} />
          Tainted only
        </label>
        <label class="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" class="h-3.5 w-3.5" bind:checked={filterCordoned} />
          Cordoned only
        </label>
        <span class="text-xs text-muted-foreground">{filteredRows.length} of {rows.length}</span>
        {#if searchValue || filterSeverity !== "all" || filterRole !== "all" || filterCondition !== "all" || filterTainted || filterCordoned}
          <Button size="sm" variant="ghost" onclick={clearFilters}>Clear filters</Button>
        {/if}
      </div>

      {#if filteredRows.length === 0}
        <div class="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
          No nodes match the current filter.
        </div>
      {:else}
        <div class="overflow-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-normal">Severity</th>
                <th class="px-2 py-1.5 font-normal">Name</th>
                <th class="px-2 py-1.5 font-normal">Role</th>
                <th class="px-2 py-1.5 font-normal">Ready</th>
                <th class="px-2 py-1.5 font-normal">Pressures</th>
                <th class="px-2 py-1.5 font-normal">Flags</th>
                <th class="px-2 py-1.5 font-normal">Capacity</th>
                <th class="px-2 py-1.5 font-normal">Version / OS</th>
                <th class="px-2 py-1.5 font-normal">Age</th>
                <th class="px-2 py-1.5 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredRows as n (n.name)}
                <tr
                  class="border-t border-border hover:bg-muted/20 {n.severity === 'critical'
                    ? 'bg-rose-500/5'
                    : n.severity === 'warning'
                      ? 'bg-amber-500/5'
                      : ''}"
                >
                  <td class="px-2 py-1">
                    <div class="flex flex-col gap-0.5">
                      <Badge class="text-white {SEVERITY_BADGE_CLASS[n.severity]}">
                        {SEVERITY_LABEL[n.severity]}
                      </Badge>
                      {#if n.flappingTypes.length > 0}
                        <span
                          class="rounded bg-fuchsia-500/20 px-1 text-[9px] text-fuchsia-300"
                          title={`Flapping on: ${n.flappingTypes.join(", ")}`}
                        >
                          FLAPPING
                        </span>
                      {/if}
                    </div>
                  </td>
                  <td class="px-2 py-1 font-mono">
                    <button class="hover:underline text-left" onclick={() => jumpToNodes(n)}>
                      {n.name}
                    </button>
                  </td>
                  <td class="px-2 py-1">{n.role || "-"}</td>
                  <td class="px-2 py-1">
                    {#if n.ready === "True"}
                      <span class="inline-flex items-center gap-1 text-emerald-400">
                        <CircleCheck class="h-3 w-3" /> Ready
                      </span>
                    {:else}
                      <span class="inline-flex items-center gap-1 text-rose-400">
                        <CircleX class="h-3 w-3" /> NotReady
                      </span>
                    {/if}
                  </td>
                  <td class="px-2 py-1">
                    <div class="flex flex-wrap gap-1">
                      {#if n.memoryPressure === "True"}
                        <Popover.Root>
                          <Popover.Trigger>
                            {#snippet child({ props })}
                              <button
                                {...props}
                                class="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300 hover:underline"
                              >
                                <CircleAlert class="h-3 w-3" /> mem
                              </button>
                            {/snippet}
                          </Popover.Trigger>
                          <Popover.Content class="w-[360px] p-2 text-xs space-y-1">
                            {@const c = n.conditions.find((x) => x.type === "MemoryPressure")}
                            {@const h = humanizeNodeCondition(
                              "MemoryPressure",
                              "True",
                              c?.reason,
                              c?.message,
                            )}
                            <p class="font-semibold">{h.title}</p>
                            <p class="text-muted-foreground">{h.hint}</p>
                            {#if c?.message}<p class="text-[10px] text-slate-400">
                                Message: {c.message}
                              </p>{/if}
                            {#if c?.lastTransitionTime}<p class="text-[10px] text-slate-400">
                                Since: {formatDate(c.lastTransitionTime)}
                              </p>{/if}
                          </Popover.Content>
                        </Popover.Root>
                      {/if}
                      {#if n.diskPressure === "True"}
                        <Popover.Root>
                          <Popover.Trigger>
                            {#snippet child({ props })}
                              <button
                                {...props}
                                class="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300 hover:underline"
                              >
                                <CircleAlert class="h-3 w-3" /> disk
                              </button>
                            {/snippet}
                          </Popover.Trigger>
                          <Popover.Content class="w-[360px] p-2 text-xs space-y-1">
                            {@const c = n.conditions.find((x) => x.type === "DiskPressure")}
                            {@const h = humanizeNodeCondition(
                              "DiskPressure",
                              "True",
                              c?.reason,
                              c?.message,
                            )}
                            <p class="font-semibold">{h.title}</p>
                            <p class="text-muted-foreground">{h.hint}</p>
                            {#if c?.message}<p class="text-[10px] text-slate-400">
                                Message: {c.message}
                              </p>{/if}
                            {#if c?.lastTransitionTime}<p class="text-[10px] text-slate-400">
                                Since: {formatDate(c.lastTransitionTime)}
                              </p>{/if}
                          </Popover.Content>
                        </Popover.Root>
                      {/if}
                      {#if n.pidPressure === "True"}
                        <span class="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300"
                          >pid</span
                        >
                      {/if}
                      {#if n.networkUnavailable === "True"}
                        <span class="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300"
                          >net</span
                        >
                      {/if}
                      {#if n.memoryPressure !== "True" && n.diskPressure !== "True" && n.pidPressure !== "True" && n.networkUnavailable !== "True"}
                        <span class="text-[10px] text-muted-foreground">none</span>
                      {/if}
                    </div>
                  </td>
                  <td class="px-2 py-1">
                    <div class="flex flex-wrap gap-1">
                      {#if n.unschedulable}
                        <span
                          class="rounded bg-slate-500/30 px-1.5 py-0.5 text-[10px] text-slate-200"
                        >
                          cordoned
                        </span>
                      {/if}
                      {#each n.taints as t (t.key + "/" + t.effect)}
                        <span
                          class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300"
                          title={`${t.key}=${t.value}:${t.effect} - ${TAINT_EFFECTS[t.effect]?.hint ?? ""}`}
                        >
                          {t.effect}
                        </span>
                      {/each}
                      {#if !n.unschedulable && n.taints.length === 0}
                        <span class="text-[10px] text-muted-foreground">-</span>
                      {/if}
                    </div>
                  </td>
                  <td class="px-2 py-1 text-[10px]">
                    <div
                      title={`CPU ${n.capacity.cpu}, mem ${n.capacity.memory} (${formatK8sMemory(n.capacity.memory)}), storage ${n.capacity.storage} (${formatK8sMemory(n.capacity.storage)})`}
                    >
                      cpu {n.capacity.cpu}, mem {formatK8sMemory(n.capacity.memory)}
                    </div>
                    {#if n.instanceType}
                      <div class="text-muted-foreground">{n.instanceType}</div>
                    {/if}
                  </td>
                  <td class="px-2 py-1 text-[10px]">
                    {#if n.kubeletVersion}
                      <div>{n.kubeletVersion}</div>
                    {/if}
                    {#if n.osImage}
                      <div class="text-muted-foreground truncate max-w-[180px]" title={n.osImage}>
                        {n.osImage}
                      </div>
                    {/if}
                  </td>
                  <td class="px-2 py-1 text-[10px]" title={formatDate(n.creationTimestamp)}>
                    {n.age}
                  </td>
                  <td class="px-2 py-1">
                    <div class="flex flex-wrap gap-1">
                      {#if n.unschedulable}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-6 text-[10px]"
                          onclick={() => copyUncordon(n)}
                        >
                          <Copy class="mr-1 h-3 w-3" /> uncordon
                        </Button>
                      {:else}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-6 text-[10px]"
                          onclick={() => copyCordon(n)}
                        >
                          <Copy class="mr-1 h-3 w-3" /> cordon
                        </Button>
                      {/if}
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyDrain(n)}
                        title="Copy drain command (review flags before running!)"
                      >
                        <Copy class="mr-1 h-3 w-3" /> drain
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyDescribe(n)}
                      >
                        <Copy class="mr-1 h-3 w-3" /> describe
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyEvents(n)}
                      >
                        <Copy class="mr-1 h-3 w-3" /> events
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyPodsOnNode(n)}
                      >
                        <Copy class="mr-1 h-3 w-3" /> pods
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyTopNode(n)}
                      >
                        <Copy class="mr-1 h-3 w-3" /> top
                      </Button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}

    {#if activeTab === "conditions"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          Nodes grouped by the condition currently active. Multiple nodes in the same group often
          signals a cluster-wide issue (CNI, etcd, disk filling up simultaneously).
        </p>
        {#if byCondition.length === 0}
          <div class="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
            All nodes are Ready and free of pressure conditions.
          </div>
        {:else}
          {#each byCondition as group (group.title)}
            {@const sample = group.nodes[0]}
            {@const firstProblemCondition =
              group.title === "Ready = False (NotReady)"
                ? sample.conditions.find((c) => c.type === "Ready")
                : sample.conditions.find((c) => c.type === group.title && c.status === "True")}
            {@const humanized =
              group.title === "Ready = False (NotReady)"
                ? humanizeNodeCondition(
                    "Ready",
                    sample.ready,
                    firstProblemCondition?.reason,
                    firstProblemCondition?.message,
                  )
                : humanizeNodeCondition(
                    group.title,
                    "True",
                    firstProblemCondition?.reason,
                    firstProblemCondition?.message,
                  )}
            <div class="rounded border border-border p-3 space-y-2">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-foreground">{group.title}</span>
                <Badge class="bg-secondary text-secondary-foreground">{group.nodes.length}</Badge>
              </div>
              <p class="text-xs text-foreground">{humanized.title}</p>
              <p class="text-xs text-muted-foreground">{humanized.hint}</p>
              <ul class="text-[11px] space-y-0.5">
                {#each group.nodes as n (n.name)}
                  <li class="flex items-center gap-2 flex-wrap">
                    <Badge class="text-white {SEVERITY_BADGE_CLASS[n.severity]} text-[9px]">
                      {SEVERITY_LABEL[n.severity]}
                    </Badge>
                    <button class="font-mono hover:underline" onclick={() => jumpToNodes(n)}>
                      {n.name}
                    </button>
                    <span class="text-muted-foreground">- {n.role}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-5 ml-auto text-[9px]"
                      onclick={() => copyDescribe(n)}
                    >
                      <Copy class="mr-1 h-3 w-3" /> describe
                    </Button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        {/if}
      </div>
    {/if}

    {#if activeTab === "taints"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          Nodes that are cordoned (<code>spec.unschedulable</code>) or tainted. These nodes are not
          broken; they explicitly deny new pods. Use this view to understand why the scheduler is
          skipping a node.
        </p>
        {#if taintedNodes.length === 0}
          <div class="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
            No cordoned or tainted nodes.
          </div>
        {:else}
          {#each taintedNodes as n (n.name)}
            <div class="rounded border border-border p-3 text-xs space-y-1">
              <div class="flex items-center gap-2 flex-wrap">
                <Badge class="text-white {SEVERITY_BADGE_CLASS[n.severity]}">
                  {SEVERITY_LABEL[n.severity]}
                </Badge>
                <button class="font-mono hover:underline" onclick={() => jumpToNodes(n)}>
                  {n.name}
                </button>
                <span class="text-muted-foreground">- {n.role}</span>
                {#if n.unschedulable}
                  <Badge class="bg-slate-500 text-white">CORDONED</Badge>
                {/if}
              </div>
              {#if n.taints.length > 0}
                <ul class="space-y-0.5">
                  {#each n.taints as t (t.key + "/" + t.effect)}
                    <li class="text-[11px]">
                      <span class="font-mono">{t.key}{t.value ? "=" + t.value : ""}</span>
                      <span class="text-muted-foreground">:{t.effect}</span>
                      {#if TAINT_EFFECTS[t.effect]}
                        <span class="text-[10px] text-muted-foreground">
                          - {TAINT_EFFECTS[t.effect].hint}
                        </span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              <div class="flex flex-wrap gap-1 pt-1">
                {#if n.unschedulable}
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 text-[10px]"
                    onclick={() => copyUncordon(n)}
                  >
                    <Copy class="mr-1 h-3 w-3" /> uncordon
                  </Button>
                {:else}
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 text-[10px]"
                    onclick={() => copyCordon(n)}
                  >
                    <Copy class="mr-1 h-3 w-3" /> cordon
                  </Button>
                {/if}
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-6 text-[10px]"
                  onclick={() => copyDescribe(n)}
                >
                  <Copy class="mr-1 h-3 w-3" /> describe
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-6 text-[10px]"
                  onclick={() => copyPodsOnNode(n)}
                >
                  <Copy class="mr-1 h-3 w-3" /> pods on node
                </Button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>
