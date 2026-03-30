<script lang="ts">
  import { beforeNavigate, goto } from "$app/navigation";
  import { page, navigating } from "$app/state";
  import { onDestroy } from "svelte";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelLeftClose from "@lucide/svelte/icons/panel-left-close";
  import { Home, Workflow } from "$shared/ui/icons";
  import { WorkloadsMenu } from "$widgets/menu";
  import { getSearchParams } from "$shared";
  import { Button } from "$shared/ui/button";
  import * as Accordion from "$shared/ui/accordion";
  import * as Select from "$shared/ui/select";
  import { LoadingSpinner } from "$shared/ui/loading-spinner";
  import { Sidebar } from "$widgets/sidebar";
  import ShellModal from "$widgets/shell/ui/shell-modal.svelte";
  import { stopAllBackgroundPollers } from "$shared/lib/background-pollers";
  import { initNetworkRecoveryListener } from "$shared/lib/network-recovery";
  import { startFleetHeartbeat } from "$features/check-health/api/fleet-heartbeat";
  import {
    clearActiveDashboardRoute,
    setActiveDashboardRoute,
  } from "$shared/lib/dashboard-route-activity";
  import { clustersList } from "$features/cluster-manager";
  import {
    dashboardDataProfile,
    hydrateDashboardDataProfile,
    hydrateDashboardRuntimeControlPlane,
    listDashboardDataProfiles,
    resolveDashboardRuntimePlaneSettings,
    resolveClusterRuntimeBudget,
    setDashboardDataProfile,
    type DashboardDataProfileId,
  } from "$shared/lib/dashboard-data-profile.svelte";
  import {
    setClusterRuntimeBudget,
    setClusterRuntimeContext,
    hydrateClusterRuntimeOverrides,
  } from "$shared/lib/cluster-runtime-manager";
  import {
    markRecentCluster,
    resolveWarmClusterCandidates,
  } from "$shared/lib/cluster-runtime-recency";

  import "$lib/app/styles/index.css";

  let { children } = $props();
  const searchParams = $derived(getSearchParams(page.url.search));
  const isDashBoardRoot = $derived(() => page.url.pathname === "/dashboard");
  let value = $state(["workloads"]);
  const loading = $derived(Boolean(navigating.to));
  const routeRemountKey = $derived.by(() => {
    const pathname = page.url.pathname;
    if (pathname.startsWith("/dashboard/clusters/")) {
      const workload = page.url.searchParams.get("workload") ?? "";
      const sort = page.url.searchParams.get("sort_field") ?? "";
      return `${pathname}?workload=${workload}&sort=${sort}`;
    }
    return pathname;
  });
  let sidebarOpen = $state(
    typeof window !== "undefined" &&
      window.localStorage.getItem("dashboard:sidebar-open") === "true",
  );
  let workloadsMenuCollapsed = $state(
    typeof window !== "undefined" &&
      window.localStorage.getItem("dashboard:workloads-menu-collapsed") === "true",
  );
  const dashboardDataProfiles = listDashboardDataProfiles();

  hydrateDashboardDataProfile();

  function gotoPage(page: string) {
    goto(page);
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    if (typeof window !== "undefined")
      window.localStorage.setItem("dashboard:sidebar-open", String(sidebarOpen));
  }

  function toggleWorkloadsMenu() {
    workloadsMenuCollapsed = !workloadsMenuCollapsed;
    if (typeof window !== "undefined")
      window.localStorage.setItem(
        "dashboard:workloads-menu-collapsed",
        String(workloadsMenuCollapsed),
      );
  }

  // Clear any leaked background timers/watchers before the next dashboard page mounts.
  stopAllBackgroundPollers();

  const cleanupNetworkRecovery = initNetworkRecoveryListener();

  $effect(() => {
    const clusters = $clustersList;
    if (clusters && clusters.length > 0) {
      startFleetHeartbeat(clusters.map((c) => c.uuid));
    }
  });

  beforeNavigate(() => {
    stopAllBackgroundPollers();
  });

  $effect(() => {
    setActiveDashboardRoute(page.url.pathname, page.url.search);
  });

  onDestroy(() => {
    clearActiveDashboardRoute();
    cleanupNetworkRecovery();
  });

  function handleDataProfileChange(value: string) {
    setDashboardDataProfile(value as DashboardDataProfileId);
  }

  function resolveActiveClusterId(pathname: string) {
    const match = pathname.match(/^\/dashboard\/clusters\/([^/]+)/);
    return match?.[1] ?? null;
  }

  $effect(() => {
    hydrateClusterRuntimeOverrides();
    hydrateDashboardRuntimeControlPlane();
    const activeClusterId = resolveActiveClusterId(page.url.pathname);
    const runtimeBudget = resolveClusterRuntimeBudget($dashboardDataProfile);
    const runtimePlanes = resolveDashboardRuntimePlaneSettings($dashboardDataProfile);
    const pinnedClusterIds = ($clustersList ?? [])
      .filter((cluster) => cluster.pinned)
      .map((cluster) => cluster.uuid);

    if (activeClusterId) {
      markRecentCluster(activeClusterId);
    }

    const warmClusterIds = resolveWarmClusterCandidates({
      activeClusterId,
      pinnedClusterIds,
      maxWarmClusters: runtimeBudget.maxWarmClusters,
    });

    setClusterRuntimeBudget(runtimeBudget);
    setClusterRuntimeContext({
      activeClusterId,
      warmClusterIds,
      resourceSyncEnabled: runtimePlanes.resourceSyncEnabled,
      diagnosticsEnabled: runtimePlanes.diagnosticsEnabled,
      metricsEnabled: runtimePlanes.metricsEnabled,
      capabilityDiscoveryEnabled: runtimePlanes.capabilityDiscoveryEnabled,
    });
  });
</script>

{#if !isDashBoardRoot()}
  <div class="dashboard-shell relative top-0 flex h-screen overflow-hidden bg-background">
    <Sidebar {sidebarOpen} {gotoPage} {toggleSidebar} />
    {#if loading}
      <div class="pointer-events-none fixed right-4 top-4 z-50">
        <LoadingSpinner />
      </div>
    {/if}
    <div class="ml-10 flex min-w-0 flex-1 overflow-hidden">
      <aside
        class={`dashboard-workloads-sidebar hidden h-screen shrink-0 border-r border-border/50 bg-muted/50 md:flex ${
          workloadsMenuCollapsed ? "w-[72px]" : "w-[250px]"
        }`}
      >
        <div
          class={`grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] ${workloadsMenuCollapsed ? "px-1" : "px-2"}`}
        >
          {#if workloadsMenuCollapsed}
            <div class="flex flex-col items-center gap-1 pt-2">
              <Button
                variant="link"
                class="h-9 w-9 justify-center px-0 !no-underline"
                onclick={() => gotoPage("/dashboard")}
                title="Dashboard"
              >
                <Home class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                onclick={toggleWorkloadsMenu}
                title="Expand cluster menu"
              >
                <PanelLeft class="h-4 w-4" />
              </Button>
            </div>
          {:else}
            <div class="flex items-center gap-1 pt-2">
              <Button
                variant="link"
                class="flex-1 justify-start text-sm !no-underline"
                onclick={() => gotoPage("/dashboard")}
                title="Dashboard"
              >
                <Home class="h-4 w-4" />
                Dashboard
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="shrink-0"
                onclick={toggleWorkloadsMenu}
                title="Collapse cluster menu"
              >
                <PanelLeftClose class="h-4 w-4" />
              </Button>
            </div>
          {/if}
          <div class="dashboard-workloads-nav relative min-h-0 overflow-hidden">
            <div class="h-full min-h-0 overflow-y-auto pb-4">
              <Accordion.Root type="multiple" bind:value>
                <Accordion.Item value="workloads">
                  <Accordion.Trigger class="!no-underline px-2">
                    <h3 class="flex items-center gap-2 text-primary">
                      <Workflow class="h-4 w-4" />
                      {#if !workloadsMenuCollapsed}
                        Cluster
                      {/if}
                    </h3>
                  </Accordion.Trigger>
                  <Accordion.Content>
                    <nav
                      class={`grid items-start text-xs font-medium ${
                        workloadsMenuCollapsed ? "justify-center px-1" : "px-2 lg:px-4"
                      }`}
                    >
                      <WorkloadsMenu {searchParams} collapsed={workloadsMenuCollapsed} />
                    </nav>
                  </Accordion.Content>
                </Accordion.Item>
              </Accordion.Root>
            </div>
            <div
              class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/80 to-transparent"
              aria-hidden="true"
            ></div>
          </div>
          <div
            class={`border-t border-border/50 bg-muted/90 ${
              workloadsMenuCollapsed ? "px-2 pb-3 pt-2" : "px-2 pb-3 pt-3"
            }`}
          >
            {#if workloadsMenuCollapsed}
              <div class="flex justify-center">
                <div
                  class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-background/70 text-muted-foreground"
                  title={`Data mode: ${$dashboardDataProfile.label}`}
                >
                  <Workflow class="h-4 w-4" />
                </div>
              </div>
            {:else}
              <div
                class="data-mode-card rounded-lg border border-border/60 bg-background/70 px-3 py-2.5"
              >
                <div
                  class="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Data Mode
                </div>
                <Select.Root
                  type="single"
                  value={$dashboardDataProfile.id}
                  onValueChange={handleDataProfileChange}
                >
                  <Select.Trigger class="h-8 w-full text-left text-sm">
                    {$dashboardDataProfile.label}
                  </Select.Trigger>
                  <Select.Content>
                    {#each dashboardDataProfiles as profile (profile.id)}
                      <Select.Item value={profile.id}>{profile.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
                <p class="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {$dashboardDataProfile.description}
                </p>
              </div>
            {/if}
          </div>
          <!-- <div class="mt-auto p-4">
            <SidebarTips />
          </div> -->
        </div>
      </aside>
      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main class="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:gap-6 lg:p-6">
          {#key routeRemountKey}
            {@render children()}
          {/key}
        </main>
      </div>
    </div>
  </div>
{:else}
  <div class="dashboard-shell relative top-0 flex h-screen overflow-hidden bg-background">
    <Sidebar {sidebarOpen} {gotoPage} {toggleSidebar} />
    {#if loading}
      <div class="pointer-events-none fixed right-4 top-4 z-50">
        <LoadingSpinner />
      </div>
    {/if}
    <main class="ml-10 flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:gap-6 lg:p-6">
      {#key routeRemountKey}
        {@render children()}
      {/key}
    </main>
  </div>
{/if}

<ShellModal />
