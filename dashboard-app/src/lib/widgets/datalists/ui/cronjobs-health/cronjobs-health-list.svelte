<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { loadClusterEntities } from "$features/check-health/api/get-cluster-info";
  import { buildCronJobsHealth } from "$features/check-health/api/cronjobs-health";
  import type { CronJobsHealth } from "$features/check-health/model/types";
  import { getTimeDifference } from "$shared";
  import DataTable from "./data-table.svelte";
  import { columns, type CronJobsHealthData } from "./columns";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";

  interface CronJobsHealthListProps {
    data: { uuid: string };
  }

  const { data }: CronJobsHealthListProps = $props();
  let cronJobsHealth: CronJobsHealth | null = $state(null);
  let allCronJobs: CronJobsHealthData[] = $state([]);
  let searchQuery = $state("");
  let onlyProblematic = $state(false);
  let isRefreshing = $state(false);
  let errorMessage = $state<string | null>(null);
  let cronJobsRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight = $state(false);
  let activeClusterId = $state<string | null>(null);
  let refreshRequestId = 0;

  const CRONJOBS_FETCH_INTERVAL_MS = 5 * 60 * 1000;

  function isPageVisible(): boolean {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  }

  function mapCronJobsHealth(check: CronJobsHealth | null) {
    if (!check) {
      allCronJobs = [];
      return;
    }

    if (!check.items) {
      allCronJobs = [];
      return;
    }

    allCronJobs = check.items.map((item) => ({
      namespace: item.namespace,
      name: item.name,
      schedule: item.schedule,
      lastScheduleTime: item.lastScheduleTime
        ? getTimeDifference(new Date(item.lastScheduleTime))
        : "Not scheduled",
      status: item.status.toUpperCase(),
      reason: item.reason,
    }));
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
        allCronJobs = [];
        return;
      }

      const health = buildCronJobsHealth(loadedData.cronjobs, loadedData.jobs);
      cronJobsHealth = health;
      errorMessage = health.error ?? null;
      mapCronJobsHealth(health);
    } catch (err) {
      if (requestId !== refreshRequestId || clusterId !== data.uuid) return;
      errorMessage = err instanceof Error ? err.message : "CronJobs data unavailable";
      cronJobsHealth = null;
      allCronJobs = [];
    } finally {
      if (requestId === refreshRequestId && clusterId === data.uuid) {
        isRefreshing = false;
        inFlight = false;
      }
    }
  }

  function startRefreshTimer() {
    if (cronJobsRefreshTimer) return;
    cronJobsRefreshTimer = setInterval(() => {
      void refreshCronJobsHealth();
    }, CRONJOBS_FETCH_INTERVAL_MS);
  }

  function stopRefreshTimer() {
    if (!cronJobsRefreshTimer) return;
    clearInterval(cronJobsRefreshTimer);
    cronJobsRefreshTimer = null;
  }

  function filterCronJobs(items: CronJobsHealthData[]) {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return items.filter((item) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.namespace.toLowerCase().includes(normalizedQuery);
      const isProblem =
        item.status.toLowerCase() === "warning" || item.status.toLowerCase() === "critical";

      return matchesQuery && (!onlyProblematic || isProblem);
    });
  }

  onMount(() => {
    if (!data?.uuid) return;
    void refreshCronJobsHealth();
    if (isPageVisible()) {
      startRefreshTimer();
    }
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
    if (isPageVisible()) startRefreshTimer();
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-wrap items-end justify-between gap-3 py-3">
    <div class="flex flex-wrap items-center gap-4">
      <Input
        placeholder="Filter CronJobs..."
        value={searchQuery}
        oninput={(event) => {
          searchQuery = event.currentTarget.value;
        }}
        class="w-full max-w-xl"
      />
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          class="h-4 w-4"
          checked={onlyProblematic}
          onchange={() => {
            onlyProblematic = !onlyProblematic;
          }}
        />
        <span>Only problematic</span>
      </label>
    </div>
    <Button
      variant="outline"
      onclick={refreshCronJobsHealth}
      loading={isRefreshing}
      loadingLabel="Refreshing"
    >
      Refresh now
    </Button>
  </div>

  {#if errorMessage}
    <div class="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      {errorMessage}
    </div>
  {/if}

  <DataTable data={filterCronJobs(allCronJobs)} {columns} />
</div>
