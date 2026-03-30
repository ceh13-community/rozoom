<script lang="ts">
  import { Input } from "$shared/ui/input";
  import { Button } from "$shared/ui/button";
  import {
    envSortPriority,
    moveEnv,
    addCustomEnv,
    removeEnv,
    resetEnvSortPriority,
  } from "$shared/lib/env-sort-priority";
  import {
    clearDashboardRuntimeControlPlane,
    dashboardDataProfile,
    dashboardRuntimeControlPlane,
    listDashboardDataProfiles,
    resolveClusterRuntimeBudget,
    resolveDashboardRuntimePlaneSettings,
    setDashboardDataProfile,
    setDashboardRuntimeControlPlane,
    type DashboardDataProfileId,
  } from "$shared/lib/dashboard-data-profile.svelte";

  const profileOptions = listDashboardDataProfiles();
  const effectiveBudget = $derived(resolveClusterRuntimeBudget($dashboardDataProfile));
  const effectivePlanes = $derived(resolveDashboardRuntimePlaneSettings($dashboardDataProfile));
  const controlPlaneOverride = $derived($dashboardRuntimeControlPlane);
  const networkSensitivityOptions = [
    { value: "fast", label: "Fast" },
    { value: "normal", label: "Normal" },
    { value: "slow", label: "Slow" },
    { value: "unstable", label: "Unstable" },
  ] as const;
  const metricsReadPolicyOptions = [
    { value: "reuse_only", label: "Reuse only" },
    { value: "cached", label: "Cached" },
    { value: "eager", label: "Eager" },
  ] as const;
  const capabilityDiscoveryModeOptions = [
    { value: "lazy", label: "Lazy" },
    { value: "background", label: "Background" },
  ] as const;

  function updateNumberOverride(
    key:
      | "maxActiveClusters"
      | "maxWarmClusters"
      | "maxConcurrentConnections"
      | "maxConcurrentClusterRefreshes"
      | "maxConcurrentDiagnostics"
      | "maxConcurrentHeavyChecks",
    value: string,
  ) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    setDashboardRuntimeControlPlane({ [key]: parsed });
  }

  let newEnvName = $state("");

  function handleAddEnv() {
    if (newEnvName.trim()) {
      addCustomEnv(newEnvName.trim());
      newEnvName = "";
    }
  }

  function updateBooleanOverride(
    key:
      | "resourceSyncEnabled"
      | "diagnosticsEnabled"
      | "metricsEnabled"
      | "capabilityDiscoveryEnabled"
      | "autoSuspendInactiveClusters",
    checked: boolean,
  ) {
    setDashboardRuntimeControlPlane({ [key]: checked });
  }
</script>

<section class="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h3 class="text-sm font-semibold">Fleet Settings</h3>
      <p class="text-xs text-muted-foreground">
        Runtime policy for multi-cluster dashboards, warm pools, and background load.
      </p>
    </div>
    <Button variant="outline" size="sm" onclick={() => clearDashboardRuntimeControlPlane()}>
      Reset global overrides
    </Button>
  </div>

  <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
    <label class="grid gap-1">
      <span class="text-xs text-muted-foreground">Dashboard profile</span>
      <select
        aria-label="Dashboard profile"
        class="border-input bg-background h-9 rounded-md border px-3 text-sm"
        value={$dashboardDataProfile.id}
        onchange={(event) =>
          setDashboardDataProfile((event.currentTarget as HTMLSelectElement).value as DashboardDataProfileId)}
      >
        {#each profileOptions as option (option.id)}
          <option value={option.id}>{option.label}</option>
        {/each}
      </select>
      <span class="text-xs text-muted-foreground">{$dashboardDataProfile.description}</span>
    </label>

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Active clusters</span>
        <Input
          aria-label="Max active clusters"
          type="number"
          min="1"
          value={String(effectiveBudget.maxActiveClusters)}
          onblur={(event) =>
            updateNumberOverride("maxActiveClusters", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Warm clusters</span>
        <Input
          aria-label="Max warm clusters"
          type="number"
          min="0"
          value={String(effectiveBudget.maxWarmClusters)}
          onblur={(event) =>
            updateNumberOverride("maxWarmClusters", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Connections</span>
        <Input
          aria-label="Max concurrent connections"
          type="number"
          min="1"
          value={String(effectiveBudget.maxConcurrentConnections)}
          onblur={(event) =>
            updateNumberOverride("maxConcurrentConnections", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Refresh concurrency</span>
        <Input
          aria-label="Max concurrent cluster refreshes"
          type="number"
          min="1"
          value={String(effectiveBudget.maxConcurrentClusterRefreshes)}
          onblur={(event) =>
            updateNumberOverride(
              "maxConcurrentClusterRefreshes",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Diagnostics concurrency</span>
        <Input
          aria-label="Max concurrent diagnostics"
          type="number"
          min="0"
          value={String(effectiveBudget.maxConcurrentDiagnostics)}
          onblur={(event) =>
            updateNumberOverride(
              "maxConcurrentDiagnostics",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Heavy checks</span>
        <Input
          aria-label="Max heavy checks"
          type="number"
          min="0"
          value={String(effectiveBudget.maxConcurrentHeavyChecks)}
          onblur={(event) =>
            updateNumberOverride("maxConcurrentHeavyChecks", (event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Network sensitivity</span>
        <select
          aria-label="Global network sensitivity"
          class="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={effectiveBudget.networkSensitivity}
          onchange={(event) =>
            setDashboardRuntimeControlPlane({
              networkSensitivity: (event.currentTarget as HTMLSelectElement).value as
                | "fast"
                | "normal"
                | "slow"
                | "unstable",
            })}
        >
          {#each networkSensitivityOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Metrics reads</span>
        <select
          aria-label="Global metrics reads policy"
          class="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={effectiveBudget.metricsReadPolicy}
          onchange={(event) =>
            setDashboardRuntimeControlPlane({
              metricsReadPolicy: (event.currentTarget as HTMLSelectElement).value as
                | "reuse_only"
                | "cached"
                | "eager",
            })}
        >
          {#each metricsReadPolicyOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Capability discovery</span>
        <select
          aria-label="Global capability discovery mode"
          class="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={effectiveBudget.capabilityDiscoveryMode}
          onchange={(event) =>
            setDashboardRuntimeControlPlane({
              capabilityDiscoveryMode: (event.currentTarget as HTMLSelectElement).value as
                | "lazy"
                | "background",
            })}
        >
          {#each capabilityDiscoveryModeOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
      <label class="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2" title="Automatically suspend watchers for inactive clusters to reduce API load">
        <span class="text-sm whitespace-nowrap">Auto-suspend</span>
        <input
          aria-label="Global auto-suspend inactive"
          type="checkbox"
          checked={effectiveBudget.autoSuspendInactiveClusters}
          onchange={(event) =>
            updateBooleanOverride(
              "autoSuspendInactiveClusters",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
      </label>
    </div>
  </div>

  <div class="mt-4 grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3 text-sm md:grid-cols-2 xl:grid-cols-4">
    <label class="flex items-center gap-2">
      <input
        aria-label="Global resource sync"
        type="checkbox"
        checked={effectivePlanes.resourceSyncEnabled}
        onchange={(event) =>
          updateBooleanOverride("resourceSyncEnabled", (event.currentTarget as HTMLInputElement).checked)}
      />
      <span>Resource sync</span>
    </label>
    <label class="flex items-center gap-2">
      <input
        aria-label="Global diagnostics"
        type="checkbox"
        checked={effectivePlanes.diagnosticsEnabled}
        onchange={(event) =>
          updateBooleanOverride("diagnosticsEnabled", (event.currentTarget as HTMLInputElement).checked)}
      />
      <span>Diagnostics</span>
    </label>
    <label class="flex items-center gap-2">
      <input
        aria-label="Global metrics"
        type="checkbox"
        checked={effectivePlanes.metricsEnabled}
        onchange={(event) =>
          updateBooleanOverride("metricsEnabled", (event.currentTarget as HTMLInputElement).checked)}
      />
      <span>Metrics</span>
    </label>
    <label class="flex items-center gap-2" title="Background discovery of cluster capabilities (CRDs, API groups)">
      <input
        aria-label="Global capability discovery"
        type="checkbox"
        checked={effectivePlanes.capabilityDiscoveryEnabled}
        onchange={(event) =>
          updateBooleanOverride(
            "capabilityDiscoveryEnabled",
            (event.currentTarget as HTMLInputElement).checked,
          )}
      />
      <span class="whitespace-nowrap">Cap. discovery</span>
    </label>
  </div>

  <div class="mt-3 text-xs text-muted-foreground">
    {#if Object.keys(controlPlaneOverride).length > 0}
      Global overrides are active on top of the shared profile.
    {:else}
      Running on the shared profile defaults without global overrides.
    {/if}
  </div>
  <div class="mt-2 text-xs text-muted-foreground">
    Effective fleet policy: {effectiveBudget.maxConcurrentClusterRefreshes} refresh / {effectiveBudget.maxConcurrentDiagnostics} diagnostics / {effectiveBudget.maxConcurrentConnections} total connections.
  </div>

  <!-- Environment Sort Priority -->
  <details class="mt-4 group">
    <summary class="flex items-center gap-2 cursor-pointer text-sm font-semibold hover:text-foreground transition-colors">
      <span class="transition-transform group-open:rotate-90 text-xs">▶</span>
      Environment Sort Order
      <span class="text-xs font-normal text-muted-foreground">
        ({$envSortPriority.length} envs)
      </span>
    </summary>
    <div class="mt-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <p class="text-xs text-muted-foreground mb-2">
        Clusters are sorted by environment priority on the dashboard and cluster manager. First env = top of list.
      </p>
      <div class="flex flex-wrap gap-1 mb-3">
        {#each $envSortPriority as env, i (env)}
          <div class="inline-flex items-center gap-0.5 rounded-md border border-border bg-background px-1.5 py-1 text-xs group/item">
            <span class="text-[10px] text-muted-foreground w-4 text-right">{i + 1}</span>
            <span class="font-medium px-1">{env}</span>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground text-[10px] px-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity"
              onclick={() => moveEnv(env, "up")}
              disabled={i === 0}
              title="Move up"
            >▲</button>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground text-[10px] px-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity"
              onclick={() => moveEnv(env, "down")}
              disabled={i === $envSortPriority.length - 1}
              title="Move down"
            >▼</button>
            <button
              type="button"
              class="text-muted-foreground hover:text-red-500 text-[10px] px-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity"
              onclick={() => removeEnv(env)}
              title="Remove"
            >✕</button>
          </div>
        {/each}
      </div>
      <div class="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Add custom env..."
          class="h-7 text-xs max-w-[180px]"
          bind:value={newEnvName}
          onkeydown={(e) => { if (e.key === "Enter") handleAddEnv(); }}
        />
        <Button variant="outline" size="sm" class="h-7 text-xs px-2" onclick={handleAddEnv}>
          Add
        </Button>
        <Button variant="ghost" size="sm" class="h-7 text-xs px-2 ml-auto" onclick={() => resetEnvSortPriority()}>
          Reset to defaults
        </Button>
      </div>
    </div>
  </details>
</section>
