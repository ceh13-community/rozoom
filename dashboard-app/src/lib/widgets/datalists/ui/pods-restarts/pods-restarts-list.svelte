<script lang="ts">
  import { onMount } from "svelte";
  import {
    getContainerReason,
    getContainerStatus,
    getLastHealthCheck,
  } from "$features/check-health";
  import type { ClusterHealthChecks } from "$features/check-health";
  import {
    humanizeRestartReason,
    type HumanizedRestartReason,
  } from "$features/pod-restarts/model/humanize";
  import {
    classifyRestartSeverity,
    SEVERITY_BADGE_CLASS,
    SEVERITY_LABEL,
    SEVERITY_ORDER,
    type RestartSeverity,
  } from "$features/pod-restarts/model/classify";
  import {
    deltaSince,
    loadSnapshot,
    saveSnapshot,
    snapshotKey,
  } from "$features/pod-restarts/model/history";
  import LoadingDots from "$shared/ui/loading-dots.svelte";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import { Button } from "$shared/ui/button";
  import { Badge } from "$shared/ui/badge";
  import { Input } from "$shared/ui/input";
  import * as Popover from "$shared/ui/popover";
  import * as Alert from "$shared/ui/alert";
  import Info from "@lucide/svelte/icons/info";
  import Refresh from "@lucide/svelte/icons/refresh-cw";
  import Download from "@lucide/svelte/icons/download";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  interface PodsRestartsListProps {
    data: { uuid: string };
  }

  const { data }: PodsRestartsListProps = $props();

  type TabKey = "overview" | "restarts" | "reasons";

  interface RestartRow {
    namespace: string;
    pod: string;
    container: string;
    restarts: number;
    delta: number;
    reason: string;
    status: string;
    startedAt: string;
    severity: RestartSeverity;
    humanized: HumanizedRestartReason;
  }

  let latestCheck: ClusterHealthChecks | null = $state(null);
  let rows = $state<RestartRow[]>([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let lastRefreshAt = $state<string | null>(null);

  let activeTab = $state<TabKey>("overview");
  let filterNamespace = $state("all");
  let filterReason = $state("all");
  let filterSeverity = $state<"all" | RestartSeverity>("all");
  let searchValue = $state("");

  const clusterId = $derived(data.uuid);

  async function refreshPodRestartsData() {
    if (!clusterId) return;
    refreshing = true;
    try {
      const nextCheck = await getLastHealthCheck(clusterId);
      if (!nextCheck || "errors" in nextCheck) {
        latestCheck = null;
        rows = [];
        return;
      }
      latestCheck = nextCheck;
      const previousSnapshot = loadSnapshot(clusterId);
      const currentCounts: Record<string, number> = {};
      const collected: RestartRow[] = [];

      for (const podRestart of latestCheck.podRestarts) {
        if (!Array.isArray(podRestart.containers)) continue;
        for (const container of podRestart.containers) {
          if (container.restartCount <= 0) continue;
          const ns = podRestart.namespace;
          const pod = podRestart.pod;
          const name = container.containerName;
          const reason = getContainerReason(container);
          const status = getContainerStatus(container);
          const startedAt = container.lastState?.running?.startedAt || container.startedAt || "";
          const delta = deltaSince(previousSnapshot, ns, pod, name, container.restartCount);
          const severity = classifyRestartSeverity({
            restartCount: container.restartCount,
            lastStartedAt: startedAt || null,
            reason,
            status,
          });
          currentCounts[snapshotKey(ns, pod, name)] = container.restartCount;
          collected.push({
            namespace: ns,
            pod,
            container: name,
            restarts: container.restartCount,
            delta,
            reason,
            status,
            startedAt,
            severity,
            humanized: humanizeRestartReason(reason),
          });
        }
      }

      rows = collected.sort((a, b) => {
        const sev = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
        if (sev !== 0) return sev;
        return b.restarts - a.restarts;
      });
      lastRefreshAt = new Date().toISOString();
      saveSnapshot(clusterId, { takenAt: lastRefreshAt, counts: currentCounts });
    } finally {
      refreshing = false;
    }
  }

  onMount(async () => {
    await refreshPodRestartsData();
    loading = false;
  });

  function formatDate(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function relativeAge(value: string | null | undefined): string {
    if (!value) return "-";
    const t = Date.parse(value);
    if (!Number.isFinite(t) || t <= 0) return "-";
    const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }

  const allNamespaces = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.namespace);
    return [...set].sort();
  });

  const allReasons = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.reason || "(empty)");
    return [...set].sort();
  });

  const filteredRows = $derived.by(() => {
    const q = searchValue.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterNamespace !== "all" && r.namespace !== filterNamespace) return false;
      if (filterReason !== "all" && (r.reason || "(empty)") !== filterReason) return false;
      if (filterSeverity !== "all" && r.severity !== filterSeverity) return false;
      if (!q) return true;
      return [r.pod, r.container, r.namespace, r.reason, r.status].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    });
  });

  const severityCounts = $derived.by(() => {
    const out: Record<RestartSeverity, number> = { stable: 0, flapping: 0, crash_loop: 0 };
    for (const r of rows) out[r.severity]++;
    return out;
  });

  const totalContainerRestarts = $derived(rows.reduce((sum, r) => sum + r.restarts, 0));
  const uniquePods = $derived(new Set(rows.map((r) => `${r.namespace}/${r.pod}`)).size);

  const topNamespace = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.namespace, (counts.get(r.namespace) ?? 0) + r.restarts);
    let best: [string, number] | null = null;
    for (const [ns, c] of counts) {
      if (!best || c > best[1]) best = [ns, c];
    }
    return best;
  });

  const topReason = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = r.reason || "(empty)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best: [string, number] | null = null;
    for (const [reason, c] of counts) {
      if (!best || c > best[1]) best = [reason, c];
    }
    return best;
  });

  interface ReasonGroup {
    reason: string;
    humanized: HumanizedRestartReason;
    rows: RestartRow[];
  }

  const groupedByReason = $derived.by<ReasonGroup[]>(() => {
    const map = new Map<string, RestartRow[]>();
    for (const r of rows) {
      const key = r.reason || "(empty)";
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([reason, list]) => ({
        reason,
        humanized: humanizeRestartReason(reason),
        rows: list,
      }))
      .sort((a, b) => b.rows.length - a.rows.length);
  });

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function copyPreviousLogs(row: RestartRow) {
    const cmd = `kubectl logs -n ${row.namespace} ${row.pod} -c ${row.container} --previous --tail=200`;
    copyText(cmd, "--previous logs command");
  }

  function copyCurrentLogs(row: RestartRow) {
    const cmd = `kubectl logs -n ${row.namespace} ${row.pod} -c ${row.container} --tail=200 -f`;
    copyText(cmd, "logs follow command");
  }

  function copyDescribe(row: RestartRow) {
    const cmd = `kubectl describe pod ${row.pod} -n ${row.namespace}`;
    copyText(cmd, "describe command");
  }

  function copyEvents(row: RestartRow) {
    const cmd = `kubectl get events -n ${row.namespace} --field-selector=involvedObject.name=${row.pod} --sort-by=.lastTimestamp`;
    copyText(cmd, "events query");
  }

  function jumpToPod(row: RestartRow) {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "pods");
    params.set("namespace", row.namespace);
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function gotoAlerts() {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "alertshub");
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function clearFilters() {
    filterNamespace = "all";
    filterReason = "all";
    filterSeverity = "all";
    searchValue = "";
  }

  function exportCsv() {
    if (filteredRows.length === 0) {
      toast.info("No rows to export");
      return;
    }
    const rowsCsv = [
      [
        "severity",
        "namespace",
        "pod",
        "container",
        "restarts",
        "delta",
        "reason",
        "status",
        "startedAt",
      ],
      ...filteredRows.map((r) => [
        r.severity,
        r.namespace,
        r.pod,
        r.container,
        String(r.restarts),
        String(r.delta),
        r.reason,
        r.status,
        r.startedAt,
      ]),
    ];
    const csv = rowsCsv
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pod-restarts-${clusterId}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <h2 class="text-lg font-semibold">Pod Restarts</h2>
      {#if rows.length > 0 && severityCounts.crash_loop > 0}
        <Badge class="bg-rose-600 text-white">{severityCounts.crash_loop} crash-looping</Badge>
      {/if}
      <Popover.Root>
        <Popover.Trigger>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="About pod restarts"
            title="About pod restarts"
          >
            <Info class="h-4 w-4" />
          </Button>
        </Popover.Trigger>
        <Popover.Content class="w-[480px] space-y-3" sideOffset={8}>
          <p class="text-sm font-semibold text-foreground">What counts as a restart</p>
          <p class="text-xs text-muted-foreground">
            Every time a container exits (cleanly or not) and kubelet re-creates it, the restart
            counter increments. A high counter signals instability - the workload is being killed or
            crashing repeatedly.
          </p>
          <p class="text-sm font-semibold text-foreground">Common reasons</p>
          <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
            <li><code>OOMKilled</code> - container hit memory limit, kernel killed it</li>
            <li><code>CrashLoopBackOff</code> - container keeps exiting; kubelet delays retries</li>
            <li><code>Error</code> - non-zero exit (panic, missing env, bad config)</li>
            <li><code>ImagePullBackOff</code> - node cannot pull the image</li>
            <li><code>Completed</code> - exit 0, normal for Job / Init / CronJob</li>
            <li><code>Evicted</code> - node ran out of disk or memory</li>
          </ul>
          <p class="text-sm font-semibold text-foreground">Triage workflow</p>
          <ol class="space-y-0.5 text-xs text-muted-foreground list-decimal pl-4">
            <li>Look at the severity column - crash-loops first</li>
            <li>Read the humanized reason + hint</li>
            <li>Copy <code>--previous</code> logs to see what failed last time</li>
            <li>Check pod events for kubelet / scheduler messages</li>
          </ol>
        </Popover.Content>
      </Popover.Root>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={() => void refreshPodRestartsData()}
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
    </div>
  </div>

  <div class="flex items-center gap-1 border-b border-border">
    {#each [{ k: "overview", label: "Overview" }, { k: "restarts", label: "Restarts" }, { k: "reasons", label: "By Reason" }] as tab (tab.k)}
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = tab.k as TabKey)}
      >
        {tab.label}
        {#if tab.k === "restarts" && rows.length > 0}
          <span class="ml-1 text-[10px] text-muted-foreground">({rows.length})</span>
        {/if}
        {#if tab.k === "reasons" && groupedByReason.length > 0}
          <span class="ml-1 text-[10px] text-muted-foreground">({groupedByReason.length})</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="px-4 py-6 text-sm text-muted-foreground">Loading pod restarts<LoadingDots /></div>
  {:else if rows.length === 0}
    <TableEmptyState
      message="No pod restarts found. If you expected restarts, verify metrics-server / kubelet access and that the cluster has workloads running."
    />
  {:else}
    {#if activeTab === "overview"}
      <div class="grid gap-3 md:grid-cols-4">
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Containers with restarts</p>
          <p class="text-2xl font-mono font-bold">{rows.length}</p>
          <p class="text-[10px] text-muted-foreground mt-0.5">{uniquePods} unique pods</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Crash-looping</p>
          <p
            class="text-2xl font-mono font-bold {severityCounts.crash_loop > 0
              ? 'text-rose-400'
              : ''}"
          >
            {severityCounts.crash_loop}
          </p>
          <p class="text-[10px] text-muted-foreground mt-0.5">need immediate attention</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Flapping</p>
          <p
            class="text-2xl font-mono font-bold {severityCounts.flapping > 0
              ? 'text-amber-400'
              : ''}"
          >
            {severityCounts.flapping}
          </p>
          <p class="text-[10px] text-muted-foreground mt-0.5">watch closely</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Total container restarts</p>
          <p class="text-2xl font-mono font-bold">{totalContainerRestarts}</p>
          <p class="text-[10px] text-muted-foreground mt-0.5">aggregate counter</p>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        {#if topNamespace}
          <div class="rounded border border-border p-2.5 text-xs">
            <p class="text-muted-foreground mb-1">Top namespace by restarts</p>
            <p class="text-sm font-mono">{topNamespace[0]}</p>
            <p class="text-[10px] text-muted-foreground">{topNamespace[1]} total restarts</p>
          </div>
        {/if}
        {#if topReason}
          <div class="rounded border border-border p-2.5 text-xs">
            <p class="text-muted-foreground mb-1">Top reason</p>
            <p class="text-sm font-mono">{topReason[0]}</p>
            <p class="text-[10px] text-muted-foreground">{topReason[1]} occurrences</p>
          </div>
        {/if}
      </div>

      <div class="rounded border border-border p-2.5 space-y-1">
        <p class="text-xs font-semibold">Severity breakdown</p>
        <div class="flex h-2 w-full rounded overflow-hidden">
          {#if severityCounts.crash_loop > 0}
            <div
              class="bg-rose-600"
              style="width: {(severityCounts.crash_loop / rows.length) * 100}%"
              title="Crash-looping: {severityCounts.crash_loop}"
            ></div>
          {/if}
          {#if severityCounts.flapping > 0}
            <div
              class="bg-amber-500"
              style="width: {(severityCounts.flapping / rows.length) * 100}%"
              title="Flapping: {severityCounts.flapping}"
            ></div>
          {/if}
          {#if severityCounts.stable > 0}
            <div
              class="bg-slate-500"
              style="width: {(severityCounts.stable / rows.length) * 100}%"
              title="Stable: {severityCounts.stable}"
            ></div>
          {/if}
        </div>
        <div class="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded bg-rose-600"></span> crash-loop {severityCounts.crash_loop}
          </span>
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded bg-amber-500"></span> flapping {severityCounts.flapping}
          </span>
          <span class="flex items-center gap-1">
            <span class="h-2 w-2 rounded bg-slate-500"></span> stable {severityCounts.stable}
          </span>
        </div>
      </div>

      {#if severityCounts.crash_loop > 0}
        <Alert.Root variant="destructive">
          <Alert.Title>Top crash-looping offenders</Alert.Title>
          <Alert.Description>
            <ul class="mt-2 space-y-1 text-xs">
              {#each rows.filter((r) => r.severity === "crash_loop").slice(0, 5) as r}
                <li class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono">{r.namespace}/{r.pod}/{r.container}</span>
                  <span class="text-muted-foreground"
                    >- {r.restarts} restarts, {r.reason || "unknown"}</span
                  >
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 text-[10px]"
                    onclick={() => copyPreviousLogs(r)}
                  >
                    <Copy class="mr-1 h-3 w-3" /> --previous logs
                  </Button>
                </li>
              {/each}
            </ul>
          </Alert.Description>
        </Alert.Root>
      {/if}

      <p class="text-xs text-muted-foreground">
        Last refresh: {formatDate(lastRefreshAt)}. Δ column compares current restart counts to the
        previous refresh.
      </p>
    {/if}

    {#if activeTab === "restarts"}
      <div class="flex flex-wrap items-center gap-2">
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterNamespace}
        >
          <option value="all">All namespaces ({allNamespaces.length})</option>
          {#each allNamespaces as ns}
            <option value={ns}>{ns}</option>
          {/each}
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterReason}
        >
          <option value="all">Any reason</option>
          {#each allReasons as reason}
            <option value={reason}>{reason}</option>
          {/each}
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={filterSeverity}
        >
          <option value="all">Any severity</option>
          <option value="crash_loop">Crash-looping</option>
          <option value="flapping">Flapping</option>
          <option value="stable">Stable</option>
        </select>
        <Input
          class="h-8 max-w-[240px] text-xs"
          placeholder="Search pod/container..."
          bind:value={searchValue}
        />
        <span class="text-xs text-muted-foreground">{filteredRows.length} of {rows.length}</span>
        {#if filterNamespace !== "all" || filterReason !== "all" || filterSeverity !== "all" || searchValue.trim()}
          <Button size="sm" variant="ghost" onclick={clearFilters}>Clear filters</Button>
        {/if}
      </div>

      {#if filteredRows.length === 0}
        <div class="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
          No restarts match the current filter.
        </div>
      {:else}
        <div class="overflow-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-normal">Severity</th>
                <th class="px-2 py-1.5 font-normal">Namespace</th>
                <th class="px-2 py-1.5 font-normal">Pod / Container</th>
                <th class="px-2 py-1.5 font-normal text-right">Restarts</th>
                <th class="px-2 py-1.5 font-normal text-right">Δ since prev</th>
                <th class="px-2 py-1.5 font-normal">Reason</th>
                <th class="px-2 py-1.5 font-normal">Last restart</th>
                <th class="px-2 py-1.5 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredRows as r (r.namespace + "/" + r.pod + "/" + r.container)}
                <tr
                  class="border-t border-border hover:bg-muted/20 {r.severity === 'crash_loop'
                    ? 'bg-rose-500/5'
                    : r.severity === 'flapping'
                      ? 'bg-amber-500/5'
                      : ''}"
                >
                  <td class="px-2 py-1">
                    <Badge class="text-white {SEVERITY_BADGE_CLASS[r.severity]}">
                      {SEVERITY_LABEL[r.severity]}
                    </Badge>
                  </td>
                  <td class="px-2 py-1 font-mono">{r.namespace}</td>
                  <td class="px-2 py-1">
                    <button
                      type="button"
                      class="text-left hover:underline"
                      onclick={() => jumpToPod(r)}
                      title="Jump to Pods page (namespace-filtered)"
                    >
                      <p class="font-mono">{r.pod}</p>
                      <p class="text-[10px] text-muted-foreground">container: {r.container}</p>
                    </button>
                  </td>
                  <td class="px-2 py-1 text-right font-mono">{r.restarts}</td>
                  <td class="px-2 py-1 text-right font-mono">
                    {#if r.delta > 0}
                      <span class="text-rose-400">+{r.delta}</span>
                    {:else}
                      <span class="text-muted-foreground">0</span>
                    {/if}
                  </td>
                  <td class="px-2 py-1">
                    <Popover.Root>
                      <Popover.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            class="text-left inline-flex items-center gap-1 hover:underline"
                            title="Click for fix hint"
                          >
                            <span class="font-mono">{r.reason || "(empty)"}</span>
                            <Info class="h-3 w-3 text-muted-foreground" />
                          </button>
                        {/snippet}
                      </Popover.Trigger>
                      <Popover.Content class="w-[380px] p-3 text-xs space-y-1.5">
                        <p class="font-semibold text-foreground">{r.humanized.title}</p>
                        <p class="text-muted-foreground">{r.humanized.hint}</p>
                        <p class="text-[10px] text-muted-foreground">
                          Category: <span class="font-mono">{r.humanized.category}</span>
                        </p>
                      </Popover.Content>
                    </Popover.Root>
                  </td>
                  <td class="px-2 py-1 text-[10px]" title={formatDate(r.startedAt)}>
                    {relativeAge(r.startedAt)}
                  </td>
                  <td class="px-2 py-1">
                    <div class="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyPreviousLogs(r)}
                        title="Copy kubectl logs --previous (shows last crash output)"
                      >
                        <Copy class="mr-1 h-3 w-3" /> --previous
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyCurrentLogs(r)}
                        title="Copy kubectl logs -f"
                      >
                        <Copy class="mr-1 h-3 w-3" /> logs -f
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyDescribe(r)}
                        title="Copy kubectl describe pod"
                      >
                        <Copy class="mr-1 h-3 w-3" /> describe
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyEvents(r)}
                        title="Copy kubectl get events for this pod"
                      >
                        <Copy class="mr-1 h-3 w-3" /> events
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

    {#if activeTab === "reasons"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          Restarts grouped by their reason. Each card shows the fix strategy and the affected
          containers.
        </p>
        {#each groupedByReason as group (group.reason)}
          <div class="rounded border border-border p-3 space-y-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono font-semibold">{group.reason}</span>
              <Badge class="bg-secondary text-secondary-foreground">{group.rows.length}</Badge>
              <span class="text-[10px] text-muted-foreground">
                {group.humanized.category} - severity {group.humanized.severity}
              </span>
            </div>
            <p class="text-xs text-foreground">{group.humanized.title}</p>
            <p class="text-xs text-muted-foreground">{group.humanized.hint}</p>
            <details class="mt-1">
              <summary class="cursor-pointer text-[11px] text-muted-foreground">
                Show {group.rows.length} affected containers
              </summary>
              <ul class="mt-1 space-y-0.5 text-[11px] max-h-60 overflow-y-auto">
                {#each group.rows as r}
                  <li class="flex items-center gap-2 flex-wrap">
                    <Badge class="text-white {SEVERITY_BADGE_CLASS[r.severity]} text-[9px]">
                      {SEVERITY_LABEL[r.severity]}
                    </Badge>
                    <button
                      class="font-mono text-left hover:underline"
                      onclick={() => jumpToPod(r)}
                    >
                      {r.namespace}/{r.pod}/{r.container}
                    </button>
                    <span class="text-muted-foreground"
                      >- {r.restarts} restarts ({relativeAge(r.startedAt)})</span
                    >
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-5 ml-auto text-[9px]"
                      onclick={() => copyPreviousLogs(r)}
                    >
                      <Copy class="mr-1 h-3 w-3" /> --previous
                    </Button>
                  </li>
                {/each}
              </ul>
            </details>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>
