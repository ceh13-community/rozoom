<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { page } from "$app/stores";
  // import { toast } from 'svelte-sonner';
  import { clustersList, loadClusters, isClustersConfigLoading } from "$features/cluster-manager";
  import { sortClustersArrayByState } from "$shared";
  import { compareClustersByEnv, loadEnvSortPriority } from "$shared/lib/env-sort-priority";
  import { ClusterInfoCard } from "$widgets/cluster";
  import ClusterInfoCardV2 from "$widgets/cluster/ui/cluster-info-card-v2.svelte";
  import RotationDebugger from "./rotation-debugger.svelte";
  import {
    clusterHealthChecks,
    hydrateLatestHealthChecks,
    pruneHealthCheckSelectors,
    pruneHealthCheckData,
  } from "$features/check-health";
  import { setCache } from "$shared/cache";
  import { Button } from "$shared/ui/button";
  import { Skeleton } from "$shared/ui/skeleton";
  import { Input } from "$shared/ui/input";
  import { ErrorMessage } from "$shared/ui/error-message";
  import { VirtualCardGrid } from "$shared/ui/virtual-card-grid";
  import { ChevronDown, Grid2X2, Grid2X2Check, List, ListCheck, Search } from "$shared/ui/icons";
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import type { AppClusterConfig } from "$entities/config";
  import {
    dashboardDataProfile,
    resolveDashboardCardAutoRefreshLimit,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import FleetSettingsPanel from "./fleet-settings-panel.svelte";
  import RuntimeHealthPanel from "./runtime-health-panel.svelte";
  import FleetDriftPanel from "./fleet-drift-panel.svelte";
  import SyntheticFleetStressPanel from "./synthetic-fleet-stress-panel.svelte";
  import { stopAllBackgroundPollers } from "$shared/lib/background-pollers";
  import { resetDashboardDiagnosticsEntitySnapshots } from "$features/check-health/model/collect-cluster-data";
  import { globalLinterEnabled, buildClusterHealthScore, saveGlobalLinterEnabled } from "$features/check-health";
  import { stopAllWatchers } from "$features/check-health/model/watchers";
  import { ShieldCheck, ShieldOff } from "$shared/ui/icons";
  import { loadClusterOrder, saveClusterOrder, applyClusterOrder } from "$shared/lib/cluster-order";
  import {
    startAutoRefreshRotation,
    stopAutoRefreshRotation,
    isIndexInAutoRefreshWindow,
  } from "$shared/lib/auto-refresh-rotation.svelte";
  import {
    buildSyntheticFleet,
    resolveSyntheticFleetSize,
    syntheticFleetHarnessEnabled,
  } from "../model/synthetic-fleet";
  import {
    loadSavedViews,
    saveSavedViews,
    addView,
    removeView,
    applyViewFilters,
    type SavedView,
    type SavedViewFilters,
  } from "$shared/lib/saved-views";
  import {
    loadGroups,
    saveGroups,
    loadGroupMembership,
    saveGroupMembership,
    addGroup,
    removeGroup as removeGroupOp,
    groupClusters,
    moveClusterToGroup,
    type ClusterGroup,
    type GroupedClusters,
  } from "$shared/lib/cluster-groups";
  import SmartGroupsPanel from "./smart-groups-panel.svelte";

  let clusters: AppClusterConfig[] = $state([]);
  let searchQuery = $state("");
  let showDashboardInfo = $state(false);
  let errors: string = $state("");
  let errorDetailed: string = $state("");
  let viewMode = $state<"list" | "grid">("grid");
  let cardVersion = $state<"compact" | "detailed">("compact");
  let initialLoadComplete: boolean = $state(false);
  let syntheticFleetSize: number | null = $state(null);
  let clusterOrder = $state<string[]>([]);
  let reorderMode = $state(false);
  let dragIdx: number | null = $state(null);
  let dropIdx: number | null = $state(null);

  // Groups & Views
  let groups = $state<ClusterGroup[]>([]);
  let groupMembership = $state<Record<string, string>>({});
  let savedViews = $state<SavedView[]>([]);
  let activeViewId = $state<string | null>(null);
  let showGroupPanel = $state(false);

  const activeView = $derived(savedViews.find((v) => v.id === activeViewId) ?? null);
  const activeFilters = $derived<SavedViewFilters>(activeView?.filters ?? {});

  const groupedClusters = $derived.by<GroupedClusters<AppClusterConfig>[]>(() => {
    const base = filteredClusters;
    const afterView = activeView ? applyViewFilters(base, activeFilters, groupMembership) : base;
    if (groups.length === 0) return [{ group: null, clusters: afterView }];
    return groupClusters(afterView, groups, groupMembership);
  });

  function sortByHealth(list: AppClusterConfig[]): AppClusterConfig[] {
    const checks = $clusterHealthChecks;
    return [...list].sort((a, b) => {
      const ca = checks[a.uuid];
      const cb = checks[b.uuid];
      const sa = ca && !("errors" in ca) ? (buildClusterHealthScore(ca)?.score ?? 100) : (ca ? -1 : 101);
      const sb = cb && !("errors" in cb) ? (buildClusterHealthScore(cb)?.score ?? 100) : (cb ? -1 : 101);
      return sa - sb;
    });
  }

  let filteredClusters = $derived.by(() => {
    if (!clusters || clusters.length === 0) return [];
    const ordered = clusterOrder.length > 0
      ? applyClusterOrder(clusters, clusterOrder)
      : sortByHealth(clusters);
    if (!searchQuery || searchQuery.trim() === "") return ordered;
    return ordered.filter((c) => {
      const name = c.name || "";
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    });
  });

  function onDragStart(e: DragEvent, index: number) {
    dragIdx = index;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", String(index));
  }
  function onDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    if (dragIdx != null && index !== dragIdx) dropIdx = index;
  }
  function onDragLeave() {
    dropIdx = null;
  }
  function onDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const srcIndex = dragIdx;
    dragIdx = null;
    dropIdx = null;
    if (srcIndex == null || srcIndex === targetIndex) return;
    const list = [...filteredClusters];
    const [moved] = list.splice(srcIndex, 1);
    list.splice(targetIndex, 0, moved);
    clusterOrder = list.map((c) => c.uuid);
    void saveClusterOrder(clusterOrder);
  }
  function onDragEnd() {
    dragIdx = null;
    dropIdx = null;
  }
  function resetOrder() {
    clusterOrder = [];
    reorderMode = false;
    void saveClusterOrder([]);
  }
  let loading = $derived($isClustersConfigLoading);
  const dashboardCardAutoRefreshLimit = $derived(
    resolveDashboardCardAutoRefreshLimit($dashboardDataProfile),
  );

  async function loadSyntheticFleetDashboard(size: number) {
    const { clusters: seededClusters, healthChecks } = buildSyntheticFleet(size);
    clustersList.set(seededClusters);
    clusterHealthChecks.set(
      Object.fromEntries(
        Object.entries(healthChecks).map(([clusterId, checks]) => [clusterId, checks?.[0] ?? null]),
      ),
    );
    try {
      await setCache("health_checks", healthChecks);
    } catch {
      // Browser preview/e2e does not expose the Tauri cache plugin. In-memory seed is enough.
    }
    clusters = sortClustersArrayByState(
      seededClusters.map((cluster) => ({
        ...cluster,
        status: cluster.offline ? "warning" : "ok",
      })),
    );
    // Skip hydrate for synthetic mode - data is already seeded in the in-memory store above.
    // hydrateLatestHealthChecks reads from cache (Tauri plugin) which may not be available
    // in browser preview/e2e, and would overwrite the seeded in-memory data with nulls.
  }

  async function loadClustersFromConfig() {
    errors = "";
    errorDetailed = "";
    clusters = [];
    initialLoadComplete = false;

    try {
      const resolvedSyntheticFleetSize = syntheticFleetHarnessEnabled()
        ? resolveSyntheticFleetSize($page.url.searchParams.get("syntheticFleet"))
        : null;
      syntheticFleetSize = resolvedSyntheticFleetSize;
      if (resolvedSyntheticFleetSize) {
        await loadSyntheticFleetDashboard(resolvedSyntheticFleetSize);
        return;
      }

      if ($clustersList?.length === 0) {
        await loadClusters();
      }

      const normalizedClusters = ($clustersList ?? []).filter(
        (cluster): cluster is AppClusterConfig =>
          !!cluster &&
          typeof cluster === "object" &&
          typeof cluster.uuid === "string" &&
          typeof cluster.name === "string",
      );

      if (normalizedClusters.length !== ($clustersList?.length ?? 0)) {
        errorDetailed = "Some invalid cluster records were skipped while rendering cards.";
      }

      clusters = normalizedClusters
        .filter((c) => !c.offline)
        .map((c) => ({
          ...c,
          status: "ok",
        }))
        .sort(compareClustersByEnv);
      await hydrateLatestHealthChecks(clusters.map((cluster) => cluster.uuid));
    } catch (error) {
      errors = "Failed to load cluster cards.";
      errorDetailed = error instanceof Error ? error.message : String(error);
      clusters = [];
    } finally {
      initialLoadComplete = true;
    }
  }

  let linterEnabled = $state(true);
  globalLinterEnabled.subscribe((v) => (linterEnabled = v));

  function toggleGlobalLinter() {
    const next = !linterEnabled;
    void saveGlobalLinterEnabled(next);
    if (!next) stopAllWatchers();
  }

  onMount(async () => {
    clusterOrder = await loadClusterOrder();
    await loadEnvSortPriority();
    groups = await loadGroups();
    groupMembership = await loadGroupMembership();
    savedViews = await loadSavedViews();
    await loadClustersFromConfig();
  });

  $effect(() => {
    const total = filteredClusters.length;
    if (total > 0 && !syntheticFleetSize) {
      startAutoRefreshRotation(total, dashboardCardAutoRefreshLimit);
    }
    return () => stopAutoRefreshRotation();
  });

  function isAutoRefreshActive(index: number): boolean {
    if (syntheticFleetSize) return false;
    if (filteredClusters.length <= dashboardCardAutoRefreshLimit) {
      return index < dashboardCardAutoRefreshLimit;
    }
    return isIndexInAutoRefreshWindow(index);
  }

  onDestroy(() => {
    stopAllBackgroundPollers();
    stopAutoRefreshRotation();
    resetDashboardDiagnosticsEntitySnapshots();

    // Prune stale health check data and derived selectors
    const activeIds = new Set(clusters.map((c) => c.uuid));
    pruneHealthCheckSelectors(activeIds);
    pruneHealthCheckData(activeIds);
  });
</script>

{#if clusters.length}
  <div class="flex items-center gap-2 mb-1">
    <h2 class="text-xl font-bold">Available Kubernetes Clusters</h2>
    <button
      onclick={() => (showDashboardInfo = !showDashboardInfo)}
      class="shrink-0 w-6 h-6 rounded-full bg-amber-400/90 dark:bg-amber-500/80 text-slate-900 dark:text-slate-900 hover:bg-amber-300 dark:hover:bg-amber-400 shadow-sm hover:shadow-md transition-all text-xs font-bold leading-none flex items-center justify-center"
      title="About this page"
    >?</button>
  </div>

  {#if showDashboardInfo}
    <div class="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-2">
          <p class="font-medium text-slate-800 dark:text-slate-100">Fleet Dashboard</p>
          <p>Real-time overview of all managed Kubernetes clusters with health scores, capacity metrics, security posture, and drift detection.</p>
          <ul class="list-disc list-inside space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            <li><strong>Compact / Detailed</strong> - toggle card density; compact for fleet overview, detailed for full diagnostics</li>
            <li><strong>List / Grid</strong> - switch layout; grid uses virtual scrolling for 20+ clusters</li>
            <li><strong>Groups</strong> - organize clusters into custom groups; smart groups auto-assign by provider/env/tags</li>
            <li><strong>Saved Views</strong> - save and quick-switch filter presets (env, provider, status, tags)</li>
            <li><strong>Fleet Control Plane</strong> - collapsible panel with data profiles, runtime health, and drift analysis</li>
            <li><strong>Auto-refresh</strong> - rotates through clusters within the configured concurrency budget</li>
            <li><strong>Health Score</strong> - composite from API server, pods, certificates, security, and config checks</li>
            <li><strong>Cluster Score</strong> - reliability + security risk scoring with top-3 risk tooltip</li>
            <li><strong>Linter toggle</strong> - enable/disable diagnostics globally or per cluster</li>
          </ul>
        </div>
        <button
          onclick={() => (showDashboardInfo = false)}
          class="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none"
        >&times;</button>
      </div>
    </div>
  {/if}
  <details class="group my-4">
    <summary class="flex items-center gap-2 cursor-pointer py-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
      <ChevronDown class="w-4 h-4 transition-transform group-open:rotate-180" />
      Fleet Control Plane
    </summary>
    <div class="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <FleetSettingsPanel />
      <RuntimeHealthPanel />
    </div>
    <div class="mt-4">
      <FleetDriftPanel />
    </div>
  </details>
  {#if syntheticFleetSize}
    <div class="mb-4">
      <SyntheticFleetStressPanel fleetSize={syntheticFleetSize} {clusters} />
    </div>
  {/if}
  <div class="flex justify-between mb-4 gap-2">
    <form class="flex-1">
      <div class="relative">
        <Search class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search clusters..."
          class="w-full border-gray-200 dark:border-slate-500 bg-sky-100 dark:bg-slate-800/30 pl-8 shadow-none md:w-2/3 lg:w-1/3"
          bind:value={searchQuery}
        />
      </div>
    </form>
    <div class="flex items-center gap-2">
      <div class="flex items-center rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden text-xs">
        <button
          class="px-2.5 py-1.5 font-semibold transition {cardVersion === 'compact' ? 'bg-slate-700 text-white' : 'bg-transparent text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-700'}"
          onclick={() => (cardVersion = "compact")}
        >Compact</button>
        <button
          class="px-2.5 py-1.5 font-semibold transition {cardVersion === 'detailed' ? 'bg-slate-700 text-white' : 'bg-transparent text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-700'}"
          onclick={() => (cardVersion = "detailed")}
        >Detailed</button>
      </div>
      <Button variant="outline" onclick={() => (viewMode = "list")}>
        {#if viewMode === "list"}<ListCheck />{:else}<List />{/if}
      </Button>
      <Button variant="outline" onclick={() => (viewMode = "grid")}>
        {#if viewMode === "grid"}<Grid2X2Check />{:else}<Grid2X2 />{/if}
      </Button>
      <Button
        variant={reorderMode ? "secondary" : "outline"}
        onclick={() => (reorderMode = !reorderMode)}
        title={reorderMode ? "Lock card order" : "Reorder cards"}
      >
        <GripVertical class="h-4 w-4" />
      </Button>
      {#if clusterOrder.length > 0}
        <Button variant="outline" onclick={resetOrder} title="Reset to default sort">
          <RotateCcw class="h-4 w-4" />
        </Button>
      {/if}
      {#if clusters.length > 0}
        <RotationDebugger filteredCount={filteredClusters.length} />
      {/if}
      <button
        class="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition {linterEnabled ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-950/50' : 'border-red-500/50 bg-red-950/30 text-red-400 hover:bg-red-950/50'}"
        onclick={toggleGlobalLinter}
        title={linterEnabled ? "Linter on - click to disable" : "Linter off - click to enable"}
      >
        {#if linterEnabled}
          <ShieldCheck class="h-3.5 w-3.5" />
        {:else}
          <ShieldOff class="h-3.5 w-3.5 animate-pulse" />
        {/if}
        Linter
      </button>
    </div>
  </div>

  <!-- Saved Views bar -->
  {#if savedViews.length > 0 || groups.length > 0}
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      {#if savedViews.length > 0}
        <span class="text-[10px] text-muted-foreground uppercase tracking-widest shrink-0">Views:</span>
        <button
          class="text-xs px-2 py-0.5 rounded-full border transition {!activeViewId ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
          onclick={() => (activeViewId = null)}
        >All</button>
        {#each savedViews as view (view.id)}
          <button
            class="text-xs px-2 py-0.5 rounded-full border transition {activeViewId === view.id ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
            onclick={() => (activeViewId = activeViewId === view.id ? null : view.id)}
          >{view.name}</button>
        {/each}
        <button
          class="text-[10px] text-slate-500 hover:text-rose-400 transition"
          title="Save current search as view"
          onclick={() => {
            const name = prompt("View name:");
            if (name?.trim()) {
              const filters: SavedViewFilters = {};
              if (searchQuery.trim()) filters.search = searchQuery.trim();
              savedViews = addView(savedViews, name.trim(), filters);
              void saveSavedViews(savedViews);
            }
          }}
        >+ Save view</button>
      {:else}
        <button
          class="text-[10px] text-slate-500 hover:text-indigo-400 transition"
          onclick={() => {
            const name = prompt("View name:");
            if (name?.trim()) {
              savedViews = addView(savedViews, name.trim(), {});
              void saveSavedViews(savedViews);
            }
          }}
        >+ Create view</button>
      {/if}

      <span class="mx-1 text-slate-700">|</span>

      <button
        class="text-[10px] px-2 py-0.5 rounded border transition {showGroupPanel ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-slate-600 text-slate-400 hover:border-slate-400'}"
        onclick={() => (showGroupPanel = !showGroupPanel)}
      >Groups ({groups.length})</button>
    </div>
  {:else}
    <div class="flex gap-2 mb-3">
      <button
        class="text-[10px] text-slate-500 hover:text-indigo-400 transition"
        onclick={() => {
          const name = prompt("View name:");
          if (name?.trim()) {
            savedViews = addView(savedViews, name.trim(), {});
            void saveSavedViews(savedViews);
          }
        }}
      >+ Create view</button>
      <button
        class="text-[10px] text-slate-500 hover:text-amber-400 transition"
        onclick={async () => {
          const name = prompt("Group name:");
          if (name?.trim()) {
            groups = addGroup(groups, name.trim());
            await saveGroups(groups);
          }
        }}
      >+ Create group</button>
    </div>
  {/if}

  <!-- Groups management panel -->
  {#if showGroupPanel}
    <div class="mb-4 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-xs space-y-2">
      <div class="flex items-center justify-between">
        <span class="font-medium text-slate-300">Cluster Groups</span>
        <button
          class="text-slate-500 hover:text-emerald-400 transition"
          onclick={async () => {
            const name = prompt("New group name:");
            if (name?.trim()) {
              groups = addGroup(groups, name.trim());
              await saveGroups(groups);
            }
          }}
        >+ Add group</button>
      </div>
      {#each groups as group (group.id)}
        <div class="flex items-center justify-between gap-2 rounded border border-slate-600 px-2 py-1">
          <span class="text-slate-200">{group.name}</span>
          <div class="flex gap-1">
            <button
              class="text-slate-500 hover:text-rose-400 transition text-[10px]"
              onclick={async () => {
                const result = removeGroupOp(groups, groupMembership, group.id);
                groups = result.groups;
                groupMembership = result.membership;
                await saveGroups(groups);
                await saveGroupMembership(groupMembership);
              }}
            >Delete</button>
          </div>
        </div>
      {/each}
      {#if groups.length > 0}
        <p class="text-[10px] text-slate-500">Drag clusters to groups or use the dropdown on each card to assign.</p>
      {/if}
    </div>
    <SmartGroupsPanel {clusters} />
  {/if}

  {#if groupedClusters.length > 0 && groups.length > 0}
    {#each groupedClusters as section (section.group?.id ?? "__ungrouped")}
      <div class="mb-4">
        <h3 class="text-sm font-semibold text-slate-400 mb-2 flex items-center gap-1.5">
          {#if section.group}
            <span class="w-2 h-2 rounded-full bg-indigo-500 inline-block"></span>
            {section.group.name}
          {:else}
            <span class="w-2 h-2 rounded-full bg-slate-600 inline-block"></span>
            Ungrouped
          {/if}
          <span class="text-[10px] text-slate-600">({section.clusters.length})</span>
        </h3>
        {#key `${cardVersion}-${linterEnabled}-${section.group?.id ?? "u"}`}
          <div class={viewMode === "grid" ? "grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "space-y-3"}>
            {#each section.clusters as cluster, index (cluster.uuid)}
              {#if cardVersion === "compact"}
                <ClusterInfoCardV2 cluster={cluster} autoRefreshActive={isAutoRefreshActive(index)} layout={viewMode === "list" ? "horizontal" : "vertical"} />
              {:else}
                <ClusterInfoCard {cluster} />
              {/if}
            {/each}
          </div>
        {/key}
      </div>
    {/each}
  {:else if filteredClusters.length}
    {#key `${cardVersion}-${linterEnabled}`}
      {#if viewMode === "list"}
        <div class="space-y-2">
          {#each filteredClusters as cluster, index (cluster.uuid)}
            <div
              role="listitem"
              draggable={reorderMode}
              ondragstart={(e) => onDragStart(e, index)}
              ondragover={(e) => onDragOver(e, index)}
              ondragleave={onDragLeave}
              ondrop={(e) => onDrop(e, index)}
              ondragend={onDragEnd}
              class="{dragIdx === index ? 'opacity-30' : ''} {dropIdx === index ? 'mt-10' : ''}"
              style="transition: margin 150ms ease"
            >
              {#if cardVersion === "compact"}
                <ClusterInfoCardV2
                  {cluster}
                  autoRefreshActive={isAutoRefreshActive(index)}
                  syntheticMode={Boolean(syntheticFleetSize)}
                  layout="horizontal"
                />
              {:else}
                <ClusterInfoCard
                  {cluster}
                  autoRefreshActive={isAutoRefreshActive(index)}
                  syntheticMode={Boolean(syntheticFleetSize)}
                />
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        {#if filteredClusters.length > 20}
          <VirtualCardGrid items={filteredClusters}>
            {#snippet children({ item, index })}
              {#if cardVersion === "compact"}
                <ClusterInfoCardV2
                  cluster={item}
                  autoRefreshActive={isAutoRefreshActive(index)}
                  syntheticMode={Boolean(syntheticFleetSize)}
                />
              {:else}
                <ClusterInfoCard
                  cluster={item}
                  autoRefreshActive={isAutoRefreshActive(index)}
                  syntheticMode={Boolean(syntheticFleetSize)}
                />
              {/if}
            {/snippet}
          </VirtualCardGrid>
        {:else}
          <div class="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {#each filteredClusters as cluster, index (cluster.uuid)}
              <div
                role="listitem"
                draggable={reorderMode}
                ondragstart={(e) => onDragStart(e, index)}
                ondragover={(e) => onDragOver(e, index)}
                ondragleave={onDragLeave}
                ondrop={(e) => onDrop(e, index)}
                ondragend={onDragEnd}
                class="{dragIdx === index ? 'opacity-30' : ''} {dropIdx === index ? 'ml-6 scale-[0.97]' : ''}"
                style="transition: margin 150ms ease, transform 150ms ease"
              >
                {#if cardVersion === "compact"}
                  <ClusterInfoCardV2
                    {cluster}
                    autoRefreshActive={isAutoRefreshActive(index)}
                    syntheticMode={Boolean(syntheticFleetSize)}
                  />
                {:else}
                  <ClusterInfoCard
                    {cluster}
                    autoRefreshActive={isAutoRefreshActive(index)}
                    syntheticMode={Boolean(syntheticFleetSize)}
                  />
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/if}
    {/key}
  {:else}
    <div class="text-center text-muted-foreground mt-8">
      <p>No clusters match your search.</p>
      <Button variant="outline" class="mt-2" onclick={() => (searchQuery = "")}>
        Clear search
      </Button>
    </div>
  {/if}
{:else if loading}
  <h2 class="text-xl font-bold">Available Kubernetes Clusters</h2>
  <p>Loading cluster list...</p>
  <div class="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-4">
    {#each Array(4) as _, i}
      <Skeleton class="h-48 w-full rounded-lg" />
    {/each}
  </div>
{:else}
  <h2 class="text-xl font-bold">Available Kubernetes Clusters</h2>
  {#if errors}
    <ErrorMessage error={errors} />
  {/if}
  {#if errorDetailed}
    <ErrorMessage error={errorDetailed} />
  {/if}
  {#if initialLoadComplete && !errors && !errorDetailed}
    <p class="text-sm text-muted-foreground mt-2">No managed clusters found yet.</p>
  {/if}
  <Button class="mt-4" onclick={loadClustersFromConfig}>⚡ Retry Loading Clusters</Button>
{/if}
