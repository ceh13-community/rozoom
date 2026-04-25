<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { loadClusterEntities } from "$features/check-health/api/get-cluster-info";
  import { buildCronJobsHealth } from "$features/check-health/api/cronjobs-health";
  import type { CronJobsHealth, CronJobHealthItem } from "$features/check-health/model/types";
  import type { CronJobItem, JobItem } from "$shared/model/clusters";
  import {
    humanizeCronReason,
    type HumanizedCronReason,
  } from "$features/cronjobs-health/model/humanize";
  import {
    describeSchedule,
    computeNextRun,
    formatDurationShort,
    type ScheduleSummary,
  } from "$features/cronjobs-health/model/schedule";
  import { getTimeDifference } from "$shared";
  import { Button } from "$shared/ui/button";
  import { Badge } from "$shared/ui/badge";
  import { Input } from "$shared/ui/input";
  import * as Popover from "$shared/ui/popover";
  import * as Alert from "$shared/ui/alert";
  import Info from "@lucide/svelte/icons/info";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Download from "@lucide/svelte/icons/download";
  import Copy from "@lucide/svelte/icons/copy";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import TableEmptyState from "$shared/ui/table-empty-state.svelte";
  import { toast } from "svelte-sonner";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  interface CronJobsHealthListProps {
    data: { uuid: string };
  }

  const { data }: CronJobsHealthListProps = $props();

  type TabKey = "overview" | "cronjobs" | "by_status";
  type StatusFilter = "all" | "ok" | "warning" | "critical" | "unknown" | "suspended";

  interface JobRun {
    name: string;
    succeeded: boolean;
    failed: boolean;
    startedAt: number;
    durationMs: number | null;
  }

  interface EnrichedRow {
    namespace: string;
    name: string;
    schedule: string;
    scheduleSummary: ScheduleSummary;
    lastScheduleTime?: string;
    lastSuccessfulTime?: string;
    lastScheduleRel: string;
    status: CronJobHealthItem["status"];
    suspended: boolean;
    concurrencyPolicy: string;
    startingDeadlineSeconds?: number;
    activeCount: number;
    nextRunLabel: string;
    overdueLabel: string | null;
    reasonRaw: string;
    humanized: HumanizedCronReason;
    lastFive: JobRun[];
  }

  let cronJobsHealth: CronJobsHealth | null = $state(null);
  let rows = $state<EnrichedRow[]>([]);
  let rawCronJobs = $state<CronJobItem[]>([]);
  let rawJobs = $state<JobItem[]>([]);

  let searchQuery = $state("");
  let onlyProblematic = $state(false);
  let statusFilter = $state<StatusFilter>("all");
  let namespaceFilter = $state("all");
  let concurrencyFilter = $state<string>("all");
  let activeTab = $state<TabKey>("overview");

  let isRefreshing = $state(false);
  let errorMessage = $state<string | null>(null);
  let cronJobsRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight = $state(false);
  let activeClusterId = $state<string | null>(null);
  let refreshRequestId = 0;
  let lastRefreshAt = $state<string | null>(null);
  let autoRefresh = $state(true);

  const CRONJOBS_FETCH_INTERVAL_MS = 5 * 60 * 1000;

  function isPageVisible(): boolean {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  }

  function enrichRow(healthItem: CronJobHealthItem): EnrichedRow {
    const raw = rawCronJobs.find(
      (c) => c.metadata.namespace === healthItem.namespace && c.metadata.name === healthItem.name,
    );
    const spec = raw?.spec ?? {};
    const extraSpec = spec as Record<string, unknown>;
    const suspended = Boolean(spec.suspend);
    const concurrency =
      typeof spec.concurrencyPolicy === "string" ? spec.concurrencyPolicy : "Allow";
    const startingDeadline =
      typeof extraSpec.startingDeadlineSeconds === "number"
        ? (extraSpec.startingDeadlineSeconds as number)
        : undefined;
    const activeCount = raw?.status.active?.length ?? 0;
    const scheduleSummary = describeSchedule(healthItem.schedule);
    const next = suspended
      ? null
      : computeNextRun(healthItem.schedule, healthItem.lastScheduleTime ?? null);
    let nextRunLabel = "-";
    let overdueLabel: string | null = null;
    if (next) {
      const diff = next.nextAt.getTime() - Date.now();
      if (next.overdueBy > 0) {
        nextRunLabel = `overdue ${formatDurationShort(next.overdueBy)}`;
        overdueLabel = nextRunLabel;
      } else {
        nextRunLabel = `in ${formatDurationShort(diff)}`;
      }
    }

    const lastScheduleRel = healthItem.lastScheduleTime
      ? getTimeDifference(new Date(healthItem.lastScheduleTime))
      : "Not scheduled";

    // Collect last 5 jobs for this CronJob
    const ownedJobs = rawJobs
      .filter((job) => {
        if (job.metadata.namespace !== healthItem.namespace) return false;
        const owned = job.metadata.ownerReferences?.some(
          (owner) => owner.kind === "CronJob" && owner.name === healthItem.name,
        );
        if (owned) return true;
        return job.metadata.labels?.["cronjob-name"] === healthItem.name;
      })
      .map<JobRun>((job) => {
        const startedAt = job.status.startTime
          ? new Date(job.status.startTime).getTime()
          : new Date(job.metadata.creationTimestamp).getTime();
        const completed = job.status.completionTime
          ? new Date(job.status.completionTime).getTime()
          : null;
        const failed =
          (job.status.failed ?? 0) > 0 ||
          (job.status.conditions ?? []).some((c) => c.type === "Failed" && c.status === "True");
        const succeeded = (job.status.succeeded ?? 0) > 0;
        return {
          name: job.metadata.name,
          succeeded,
          failed,
          startedAt,
          durationMs: completed ? Math.max(0, completed - startedAt) : null,
        };
      })
      .sort((a, b) => b.startedAt - a.startedAt);
    const lastFive = ownedJobs.slice(0, 5);

    let status = healthItem.status;
    const reasonRaw = suspended ? `Suspended; ${healthItem.reason}` : healthItem.reason;
    if (suspended && (status === "ok" || status === "unknown")) {
      status = "ok";
    }

    return {
      namespace: healthItem.namespace,
      name: healthItem.name,
      schedule: healthItem.schedule,
      scheduleSummary,
      lastScheduleTime: healthItem.lastScheduleTime,
      lastSuccessfulTime: healthItem.lastSuccessfulTime,
      lastScheduleRel,
      status,
      suspended,
      concurrencyPolicy: concurrency,
      startingDeadlineSeconds: startingDeadline,
      activeCount,
      nextRunLabel,
      overdueLabel,
      reasonRaw,
      humanized: humanizeCronReason(suspended ? "Suspended" : healthItem.reason),
      lastFive,
    };
  }

  async function refreshCronJobsHealth() {
    if (!data?.uuid) return;
    if (!isPageVisible() || inFlight) return;
    const clusterId = data.uuid;
    const requestId = ++refreshRequestId;

    inFlight = true;
    isRefreshing = true;
    errorMessage = null;

    try {
      const loadedData = await loadClusterEntities({ uuid: clusterId }, ["cronjobs", "jobs"]);
      if (requestId !== refreshRequestId || clusterId !== data.uuid) return;

      if (loadedData.status !== "ok") {
        errorMessage = loadedData.errors ?? "CronJobs data unavailable";
        cronJobsHealth = null;
        rows = [];
        return;
      }

      const health = buildCronJobsHealth(loadedData.cronjobs, loadedData.jobs);
      cronJobsHealth = health;
      rawCronJobs = loadedData.cronjobs?.items ?? [];
      rawJobs = loadedData.jobs?.items ?? [];
      errorMessage = health.error ?? null;
      rows = (health.items ?? []).map((item) => enrichRow(item));
      lastRefreshAt = new Date().toISOString();
    } catch (err) {
      if (requestId !== refreshRequestId || clusterId !== data.uuid) return;
      errorMessage = err instanceof Error ? err.message : "CronJobs data unavailable";
      cronJobsHealth = null;
      rows = [];
    } finally {
      if (requestId === refreshRequestId && clusterId === data.uuid) {
        isRefreshing = false;
        inFlight = false;
      }
    }
  }

  function startRefreshTimer() {
    if (cronJobsRefreshTimer || !autoRefresh) return;
    cronJobsRefreshTimer = setInterval(() => {
      void refreshCronJobsHealth();
    }, CRONJOBS_FETCH_INTERVAL_MS);
  }

  function stopRefreshTimer() {
    if (!cronJobsRefreshTimer) return;
    clearInterval(cronJobsRefreshTimer);
    cronJobsRefreshTimer = null;
  }

  function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    if (autoRefresh && isPageVisible()) startRefreshTimer();
    else stopRefreshTimer();
  }

  onMount(() => {
    if (!data?.uuid) return;
    void refreshCronJobsHealth();
    if (isPageVisible()) startRefreshTimer();
    const handleVisibility = () => {
      if (isPageVisible()) {
        void refreshCronJobsHealth();
        startRefreshTimer();
        return;
      }
      stopRefreshTimer();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });

  onDestroy(() => {
    stopRefreshTimer();
  });

  $effect(() => {
    const clusterId = data?.uuid ?? null;
    if (!clusterId) return;
    if (activeClusterId === clusterId) return;
    activeClusterId = clusterId;
    refreshRequestId += 1;
    inFlight = false;
    isRefreshing = false;
    void refreshCronJobsHealth();
    if (isPageVisible() && autoRefresh) startRefreshTimer();
  });

  const allNamespaces = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.namespace);
    return [...set].sort();
  });

  const allConcurrency = $derived.by(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.concurrencyPolicy);
    return [...set].sort();
  });

  const filteredRows = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (namespaceFilter !== "all" && r.namespace !== namespaceFilter) return false;
      if (concurrencyFilter !== "all" && r.concurrencyPolicy !== concurrencyFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "suspended") {
          if (!r.suspended) return false;
        } else if (r.status !== statusFilter || r.suspended) {
          return false;
        }
      }
      if (onlyProblematic) {
        const isProblem = r.status === "warning" || r.status === "critical" || r.overdueLabel;
        if (!isProblem) return false;
      }
      if (!q) return true;
      return [r.name, r.namespace, r.schedule, r.reasonRaw, r.humanized.title].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      );
    });
  });

  const counts = $derived.by(() => {
    const out = {
      total: rows.length,
      ok: 0,
      warning: 0,
      critical: 0,
      unknown: 0,
      suspended: 0,
      overdue: 0,
      active: 0,
    };
    for (const r of rows) {
      if (r.suspended) out.suspended++;
      else out[r.status]++;
      if (r.overdueLabel) out.overdue++;
      out.active += r.activeCount;
    }
    return out;
  });

  const topOffenders = $derived.by(() =>
    rows
      .filter((r) => r.status === "critical" || r.status === "warning" || r.overdueLabel)
      .sort((a, b) => {
        const rank: Record<string, number> = { critical: 3, warning: 2, ok: 1, unknown: 0 };
        const diff = (rank[b.status] ?? 0) - (rank[a.status] ?? 0);
        if (diff !== 0) return diff;
        return (b.overdueLabel ? 1 : 0) - (a.overdueLabel ? 1 : 0);
      })
      .slice(0, 5),
  );

  const byReason = $derived.by(() => {
    const map = new Map<string, EnrichedRow[]>();
    for (const r of rows) {
      const key = r.humanized.title;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([title, list]) => ({ title, rows: list, category: list[0].humanized.category }))
      .sort((a, b) => b.rows.length - a.rows.length);
  });

  const statusStyles: Record<CronJobHealthItem["status"], string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    critical: "bg-rose-600",
    unknown: "bg-slate-500",
  };

  function formatDate(value: string | null | undefined) {
    if (!value) return "-";
    return new Date(value).toLocaleString();
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error(`Failed to copy ${label}`),
    );
  }

  function copyTrigger(r: EnrichedRow) {
    const jobName = `${r.name}-manual-${Math.floor(Date.now() / 1000)}`.slice(0, 63);
    const cmd = `kubectl create job --from=cronjob/${r.name} ${jobName} -n ${r.namespace}`;
    copyText(cmd, "manual-trigger command");
  }

  function copySuspend(r: EnrichedRow) {
    const cmd = `kubectl patch cronjob ${r.name} -n ${r.namespace} -p '{"spec":{"suspend":true}}' --type=merge`;
    copyText(cmd, "suspend command");
  }

  function copyUnsuspend(r: EnrichedRow) {
    const cmd = `kubectl patch cronjob ${r.name} -n ${r.namespace} -p '{"spec":{"suspend":false}}' --type=merge`;
    copyText(cmd, "unsuspend command");
  }

  function copyDescribe(r: EnrichedRow) {
    copyText(`kubectl describe cronjob ${r.name} -n ${r.namespace}`, "describe command");
  }

  function copyLatestLogs(r: EnrichedRow) {
    const latest = r.lastFive[0];
    if (!latest) {
      toast.error("No recent Job to fetch logs from");
      return;
    }
    copyText(
      `kubectl logs -n ${r.namespace} job/${latest.name} --all-containers=true --tail=200`,
      "latest Job logs command",
    );
  }

  function copyEvents(r: EnrichedRow) {
    copyText(
      `kubectl get events -n ${r.namespace} --field-selector=involvedObject.name=${r.name}`,
      "events query",
    );
  }

  function jumpToCronJob(r: EnrichedRow) {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "cronjobs");
    params.set("namespace", r.namespace);
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function jumpToJobs(r: EnrichedRow) {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "jobs");
    params.set("namespace", r.namespace);
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function gotoAlerts() {
    const params = new URLSearchParams($page.url.search);
    params.set("workload", "alertshub");
    void goto(`?${params.toString()}`, { keepFocus: false });
  }

  function clearFilters() {
    searchQuery = "";
    statusFilter = "all";
    namespaceFilter = "all";
    concurrencyFilter = "all";
    onlyProblematic = false;
  }

  function exportCsv() {
    if (filteredRows.length === 0) {
      toast.info("No rows to export");
      return;
    }
    const data: (string | number)[][] = [
      [
        "namespace",
        "name",
        "schedule",
        "human",
        "status",
        "suspended",
        "concurrency",
        "activeJobs",
        "lastScheduleTime",
        "lastSuccessfulTime",
        "nextRun",
        "reason",
      ],
      ...filteredRows.map((r) => [
        r.namespace,
        r.name,
        r.schedule,
        r.scheduleSummary.humanReadable,
        r.status,
        String(r.suspended),
        r.concurrencyPolicy,
        r.activeCount,
        r.lastScheduleTime ?? "",
        r.lastSuccessfulTime ?? "",
        r.nextRunLabel,
        r.reasonRaw,
      ]),
    ];
    const csv = data
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cronjobs-health-${data[1]?.[0] ?? "cluster"}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <h2 class="text-lg font-semibold">CronJobs Monitoring</h2>
      {#if counts.critical > 0}
        <Badge class="bg-rose-600 text-white">{counts.critical} critical</Badge>
      {/if}
      {#if counts.overdue > 0}
        <Badge class="bg-amber-500 text-white">{counts.overdue} overdue</Badge>
      {/if}
      <Popover.Root>
        <Popover.Trigger>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label="About CronJobs monitoring"
            title="About CronJobs monitoring"
          >
            <Info class="h-4 w-4" />
          </Button>
        </Popover.Trigger>
        <Popover.Content class="w-[520px] space-y-3" sideOffset={8}>
          <p class="text-sm font-semibold text-foreground">What this page tracks</p>
          <p class="text-xs text-muted-foreground">
            A CronJob spawns a Job on a schedule. This panel checks the schedule expression, how
            long ago the last run happened, whether active Jobs are overrunning, and whether the
            latest Job failed.
          </p>
          <p class="text-sm font-semibold text-foreground">Statuses and typical causes</p>
          <ul class="space-y-1 text-xs text-muted-foreground list-disc pl-4">
            <li>
              <span class="text-foreground">Missed schedule</span> - controller-manager was down; `startingDeadlineSeconds`
              too small; `concurrencyPolicy: Forbid` with an active long-running Job; cluster clock skew.
            </li>
            <li>
              <span class="text-foreground">Last job failed</span> - pod exited non-zero. Look at pod
              logs and events.
            </li>
            <li>
              <span class="text-foreground">Running longer</span> - active Job exceeds 2x the schedule
              interval. Raise `activeDeadlineSeconds` or tune the workload.
            </li>
            <li>
              <span class="text-foreground">Suspended</span> - `spec.suspend=true`. Intentional pause.
            </li>
          </ul>
          <p class="text-sm font-semibold text-foreground">Triage workflow</p>
          <ol class="text-xs text-muted-foreground list-decimal pl-4 space-y-0.5">
            <li>Start from red/overdue offenders in the Overview tab</li>
            <li>Hover the Reason column to get a fix hint</li>
            <li>Copy the Latest Job logs action for post-mortem</li>
            <li>Use Trigger for ad-hoc runs while investigating</li>
          </ol>
        </Popover.Content>
      </Popover.Root>
    </div>
    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onclick={refreshCronJobsHealth}
        loading={isRefreshing}
        loadingLabel="Refreshing"
      >
        <RefreshCw class="mr-2 h-3.5 w-3.5" /> Refresh now
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onclick={toggleAutoRefresh}
        title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh every 5 min"}
      >
        {#if autoRefresh}
          <Pause class="mr-2 h-3.5 w-3.5" /> Pause auto-refresh
        {:else}
          <Play class="mr-2 h-3.5 w-3.5" /> Resume auto-refresh
        {/if}
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
    {#each [{ k: "overview", label: "Overview" }, { k: "cronjobs", label: "CronJobs" }, { k: "by_status", label: "By Status" }] as tab (tab.k)}
      <button
        type="button"
        class="px-3 py-1.5 text-xs font-medium border-b-2 -mb-px {activeTab === tab.k
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = tab.k as TabKey)}
      >
        {tab.label}
        {#if tab.k === "cronjobs" && rows.length > 0}
          <span class="ml-1 text-[10px] text-muted-foreground">({rows.length})</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if errorMessage}
    <Alert.Root variant="destructive">
      <Alert.Title>CronJobs data issue</Alert.Title>
      <Alert.Description>{errorMessage}</Alert.Description>
    </Alert.Root>
  {/if}

  {#if rows.length === 0 && !isRefreshing}
    <TableEmptyState
      message={errorMessage
        ? "CronJobs data is unavailable. Check cluster connectivity and RBAC for cronjobs + jobs."
        : "No CronJobs in this cluster. Create one with `kubectl create cronjob ... --schedule '0 3 * * *' -- ...`."}
    />
  {:else}
    {#if activeTab === "overview"}
      <div class="grid gap-3 md:grid-cols-5">
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Total</p>
          <p class="text-2xl font-mono font-bold">{counts.total}</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">OK</p>
          <p class="text-2xl font-mono font-bold text-emerald-400">{counts.ok}</p>
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
          <p class="text-muted-foreground mb-1">Suspended</p>
          <p class="text-2xl font-mono font-bold text-slate-400">{counts.suspended}</p>
        </div>
      </div>

      <div class="grid gap-3 md:grid-cols-3">
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Overdue runs</p>
          <p class="text-lg font-mono {counts.overdue > 0 ? 'text-amber-400' : ''}">
            {counts.overdue}
          </p>
          <p class="text-[10px] text-muted-foreground mt-0.5">next run is past due</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Active Jobs across all CronJobs</p>
          <p class="text-lg font-mono">{counts.active}</p>
          <p class="text-[10px] text-muted-foreground mt-0.5">currently executing</p>
        </div>
        <div class="rounded border border-border p-2.5 text-xs">
          <p class="text-muted-foreground mb-1">Auto-refresh</p>
          <p class="text-xs">
            {autoRefresh ? "every 5 min" : "paused"} - last refresh: {formatDate(lastRefreshAt)}
          </p>
        </div>
      </div>

      {#if topOffenders.length > 0}
        <Alert.Root variant="default">
          <Alert.Title>Top offenders ({topOffenders.length})</Alert.Title>
          <Alert.Description>
            <ul class="mt-2 space-y-1.5 text-xs">
              {#each topOffenders as r (r.namespace + "/" + r.name)}
                <li class="flex flex-wrap items-center gap-2">
                  <Badge class="text-white {statusStyles[r.status]}">{r.status}</Badge>
                  <span class="font-mono">{r.namespace}/{r.name}</span>
                  <span class="text-muted-foreground">- {r.humanized.title}</span>
                  {#if r.overdueLabel}
                    <span class="text-amber-400">- {r.overdueLabel}</span>
                  {/if}
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 ml-auto text-[10px]"
                    onclick={() => copyLatestLogs(r)}
                    title="Copy kubectl logs for latest Job"
                  >
                    <Copy class="mr-1 h-3 w-3" /> latest logs
                  </Button>
                </li>
              {/each}
            </ul>
          </Alert.Description>
        </Alert.Root>
      {/if}
    {/if}

    {#if activeTab === "cronjobs"}
      <div class="flex flex-wrap items-center gap-2">
        <Input
          class="h-8 max-w-[240px] text-xs"
          placeholder="Search name, schedule, reason..."
          bind:value={searchQuery}
        />
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={namespaceFilter}
        >
          <option value="all">All namespaces ({allNamespaces.length})</option>
          {#each allNamespaces as ns}
            <option value={ns}>{ns}</option>
          {/each}
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={statusFilter}
        >
          <option value="all">Any status</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="ok">OK</option>
          <option value="unknown">Unknown</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          class="h-8 rounded border border-input bg-background px-2 text-xs"
          bind:value={concurrencyFilter}
        >
          <option value="all">Any concurrency</option>
          {#each allConcurrency as c}
            <option value={c}>{c}</option>
          {/each}
        </select>
        <label class="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            class="h-3.5 w-3.5"
            checked={onlyProblematic}
            onchange={() => (onlyProblematic = !onlyProblematic)}
          />
          Only problematic
        </label>
        <span class="text-xs text-muted-foreground">{filteredRows.length} of {rows.length}</span>
        {#if searchQuery || statusFilter !== "all" || namespaceFilter !== "all" || concurrencyFilter !== "all" || onlyProblematic}
          <Button size="sm" variant="ghost" onclick={clearFilters}>Clear filters</Button>
        {/if}
      </div>

      {#if filteredRows.length === 0}
        <div class="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
          No CronJobs match the current filter.
        </div>
      {:else}
        <div class="overflow-auto rounded border border-border">
          <table class="w-full text-xs">
            <thead class="bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th class="px-2 py-1.5 font-normal">Status</th>
                <th class="px-2 py-1.5 font-normal">Namespace / Name</th>
                <th class="px-2 py-1.5 font-normal">Schedule</th>
                <th class="px-2 py-1.5 font-normal">Last</th>
                <th class="px-2 py-1.5 font-normal">Next</th>
                <th class="px-2 py-1.5 font-normal">Active</th>
                <th class="px-2 py-1.5 font-normal">Concurrency</th>
                <th class="px-2 py-1.5 font-normal">Last 5</th>
                <th class="px-2 py-1.5 font-normal">Reason</th>
                <th class="px-2 py-1.5 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredRows as r (r.namespace + "/" + r.name)}
                <tr
                  class="border-t border-border hover:bg-muted/20 {r.status === 'critical'
                    ? 'bg-rose-500/5'
                    : r.status === 'warning'
                      ? 'bg-amber-500/5'
                      : ''}"
                >
                  <td class="px-2 py-1">
                    <div class="flex flex-col gap-0.5">
                      <Badge class="text-white {statusStyles[r.status]}">{r.status}</Badge>
                      {#if r.suspended}
                        <Badge class="bg-slate-500 text-white text-[9px]">SUSPENDED</Badge>
                      {/if}
                    </div>
                  </td>
                  <td class="px-2 py-1">
                    <button
                      type="button"
                      class="text-left hover:underline"
                      onclick={() => jumpToCronJob(r)}
                      title="Jump to CronJobs page"
                    >
                      <p class="text-[10px] text-muted-foreground">{r.namespace}</p>
                      <p class="font-mono">{r.name}</p>
                    </button>
                  </td>
                  <td class="px-2 py-1">
                    <p class="font-mono text-[10px]">{r.schedule}</p>
                    <p class="text-[10px] text-muted-foreground">
                      {r.scheduleSummary.humanReadable}
                    </p>
                  </td>
                  <td class="px-2 py-1 text-[10px]" title={formatDate(r.lastScheduleTime)}>
                    {r.lastScheduleRel}
                  </td>
                  <td
                    class="px-2 py-1 text-[10px] {r.overdueLabel
                      ? 'text-amber-400'
                      : 'text-muted-foreground'}"
                  >
                    {r.suspended ? "paused" : r.nextRunLabel}
                  </td>
                  <td class="px-2 py-1 text-center font-mono">
                    {#if r.activeCount > 0}
                      <button
                        class="text-primary hover:underline"
                        onclick={() => jumpToJobs(r)}
                        title="View Jobs"
                      >
                        {r.activeCount}
                      </button>
                    {:else}
                      <span class="text-muted-foreground">0</span>
                    {/if}
                  </td>
                  <td class="px-2 py-1 text-[10px]">
                    <span>{r.concurrencyPolicy}</span>
                    {#if r.startingDeadlineSeconds != null}
                      <div class="text-[9px] text-muted-foreground">
                        deadline: {r.startingDeadlineSeconds}s
                      </div>
                    {/if}
                  </td>
                  <td class="px-2 py-1">
                    {#if r.lastFive.length === 0}
                      <span class="text-[10px] text-muted-foreground">-</span>
                    {:else}
                      <div class="flex items-center gap-0.5">
                        {#each r.lastFive as run (run.name)}
                          <span
                            class="h-2 w-2 rounded-full {run.succeeded
                              ? 'bg-emerald-500'
                              : run.failed
                                ? 'bg-rose-500'
                                : 'bg-amber-500'}"
                            title={`${run.name} ${run.succeeded ? "OK" : run.failed ? "FAILED" : "running"}${run.durationMs != null ? ` (${formatDurationShort(run.durationMs)})` : ""}`}
                          ></span>
                        {/each}
                      </div>
                    {/if}
                  </td>
                  <td class="px-2 py-1">
                    <Popover.Root>
                      <Popover.Trigger>
                        {#snippet child({ props })}
                          <button
                            {...props}
                            class="inline-flex items-center gap-1 hover:underline text-left"
                          >
                            <span class="text-[10px]">{r.humanized.title}</span>
                            <Info class="h-3 w-3 text-muted-foreground" />
                          </button>
                        {/snippet}
                      </Popover.Trigger>
                      <Popover.Content class="w-[380px] p-3 text-xs space-y-1">
                        <p class="font-semibold text-foreground">{r.humanized.title}</p>
                        <p class="text-muted-foreground">{r.humanized.hint}</p>
                        <p class="text-[10px] text-muted-foreground">
                          Raw: <span class="font-mono">{r.reasonRaw}</span>
                        </p>
                      </Popover.Content>
                    </Popover.Root>
                  </td>
                  <td class="px-2 py-1">
                    <div class="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyTrigger(r)}
                        title="Copy kubectl create job --from=cronjob/... (manual run)"
                      >
                        <Copy class="mr-1 h-3 w-3" /> trigger
                      </Button>
                      {#if r.suspended}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-6 text-[10px]"
                          onclick={() => copyUnsuspend(r)}
                          title="Copy kubectl patch to un-suspend"
                        >
                          <Play class="mr-1 h-3 w-3" /> unsuspend
                        </Button>
                      {:else}
                        <Button
                          size="sm"
                          variant="ghost"
                          class="h-6 text-[10px]"
                          onclick={() => copySuspend(r)}
                          title="Copy kubectl patch to suspend"
                        >
                          <Pause class="mr-1 h-3 w-3" /> suspend
                        </Button>
                      {/if}
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyLatestLogs(r)}
                      >
                        <Copy class="mr-1 h-3 w-3" /> logs
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyDescribe(r)}
                      >
                        <Copy class="mr-1 h-3 w-3" /> describe
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 text-[10px]"
                        onclick={() => copyEvents(r)}
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

    {#if activeTab === "by_status"}
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          CronJobs grouped by their humanized reason. Use this view to spot systemic issues (e.g.
          many jobs missing schedule at once signals controller-manager or clock problems).
        </p>
        {#each byReason as group (group.title)}
          <div class="rounded border border-border p-3 space-y-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-foreground">{group.title}</span>
              <Badge class="bg-secondary text-secondary-foreground">{group.rows.length}</Badge>
              <span class="text-[10px] text-muted-foreground">category: {group.category}</span>
            </div>
            <p class="text-xs text-muted-foreground">{group.rows[0].humanized.hint}</p>
            <details class="mt-1">
              <summary class="cursor-pointer text-[11px] text-muted-foreground">
                Show {group.rows.length} CronJobs
              </summary>
              <ul class="mt-1 space-y-0.5 text-[11px] max-h-60 overflow-y-auto">
                {#each group.rows as r (r.namespace + "/" + r.name)}
                  <li class="flex items-center gap-2 flex-wrap">
                    <Badge class="text-white {statusStyles[r.status]} text-[9px]">{r.status}</Badge>
                    <button class="font-mono hover:underline" onclick={() => jumpToCronJob(r)}>
                      {r.namespace}/{r.name}
                    </button>
                    <span class="text-[10px] text-muted-foreground"
                      >{r.scheduleSummary.humanReadable}</span
                    >
                    {#if r.overdueLabel}
                      <span class="text-amber-400 text-[10px]">{r.overdueLabel}</span>
                    {/if}
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-5 ml-auto text-[9px]"
                      onclick={() => copyLatestLogs(r)}
                    >
                      <Copy class="mr-1 h-3 w-3" /> logs
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
