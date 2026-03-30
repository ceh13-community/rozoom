<script lang="ts">
  import { Badge } from "$shared/ui/badge";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import {
    clusterRuntimeContext,
    clusterRuntimeOverrides,
    clearClusterRuntimeOverride,
    resolveClusterRuntimeBudgetForCluster,
    resolveClusterRuntimeState,
    setClusterRuntimeOverride,
    type ClusterRuntimeOverride,
    type ClusterRuntimeState,
  } from "$shared/lib/cluster-runtime-manager";
  import {
    dashboardDataProfile,
    resolveClusterRuntimeBudget,
  } from "$shared/lib/dashboard-data-profile.svelte";

  type Props = {
    clusterId: string;
  };

  let { clusterId }: Props = $props();

  const runtimeStateOptions: Array<{ value: ClusterRuntimeState; label: string }> = [
    { value: "active", label: "Active" },
    { value: "warm", label: "Warm" },
    { value: "background", label: "Background" },
    { value: "degraded", label: "Degraded" },
    { value: "offline", label: "Offline" },
  ];
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

  const override = $derived($clusterRuntimeOverrides[clusterId] ?? null);
  const effectiveBudget = $derived(resolveClusterRuntimeBudgetForCluster(clusterId));
  const effectiveState = $derived(resolveClusterRuntimeState(clusterId));
  const baseBudget = $derived(resolveClusterRuntimeBudget($dashboardDataProfile));
  const effectiveDiagnosticsEnabled = $derived(
    override?.diagnosticsEnabled ?? $clusterRuntimeContext.diagnosticsEnabled,
  );
  const effectiveMetricsEnabled = $derived(
    override?.metricsEnabled ?? $clusterRuntimeContext.metricsEnabled,
  );
  const effectiveResourceSyncEnabled = $derived(
    override?.resourceSyncEnabled ?? $clusterRuntimeContext.resourceSyncEnabled,
  );
  const effectiveCapabilityDiscoveryEnabled = $derived(
    override?.capabilityDiscoveryEnabled ?? $clusterRuntimeContext.capabilityDiscoveryEnabled,
  );

  function updateOverride(next: ClusterRuntimeOverride) {
    setClusterRuntimeOverride(clusterId, next);
  }

  function updateBooleanOverride(
    key: keyof Pick<
      ClusterRuntimeOverride,
      "diagnosticsEnabled" | "metricsEnabled" | "resourceSyncEnabled" | "capabilityDiscoveryEnabled"
    >,
    checked: boolean,
  ) {
    updateOverride({ [key]: checked });
  }

  function updateNumberOverride(
    key: keyof Pick<
      ClusterRuntimeOverride,
      | "maxConcurrentConnections"
      | "maxConcurrentClusterRefreshes"
      | "maxConcurrentDiagnostics"
      | "maxConcurrentHeavyChecks"
    >,
    value: string,
  ) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    updateOverride({ [key]: parsed });
  }

  function stateTone(state: ClusterRuntimeState) {
    if (state === "active") return "bg-emerald-600 text-white";
    if (state === "warm") return "bg-sky-600 text-white";
    if (state === "background") return "bg-slate-500 text-white";
    if (state === "degraded") return "bg-amber-600 text-white";
    return "bg-rose-600 text-white";
  }
</script>

<div class="w-[360px] space-y-4 text-sm">
  <div class="space-y-1">
    <div class="flex items-center justify-between gap-2">
      <div class="font-medium">Runtime tuning</div>
      <Badge class={stateTone(effectiveState)}>{effectiveState}</Badge>
    </div>
    <div class="text-xs text-muted-foreground">
      Base profile: {$dashboardDataProfile.label}. Override applies only to this cluster.
    </div>
  </div>

  <div class="grid gap-3">
    <label class="grid gap-1">
      <span class="text-xs text-muted-foreground">Runtime state</span>
      <select
        aria-label="Runtime state"
        class="border-input bg-background h-9 rounded-md border px-3 text-sm"
        value={effectiveState}
        onchange={(event) =>
          updateOverride({ state: (event.currentTarget as HTMLSelectElement).value as ClusterRuntimeState })}
      >
        {#each runtimeStateOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="grid gap-1">
      <span class="text-xs text-muted-foreground">Network sensitivity</span>
      <select
        aria-label="Network sensitivity"
        class="border-input bg-background h-9 rounded-md border px-3 text-sm"
        value={effectiveBudget.networkSensitivity}
        onchange={(event) =>
          updateOverride({
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

    <div class="grid grid-cols-2 gap-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Connections</span>
        <Input
          aria-label="Max concurrent connections"
          type="number"
          min="1"
          value={String(effectiveBudget.maxConcurrentConnections)}
          onblur={(event) =>
            updateNumberOverride(
              "maxConcurrentConnections",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Refreshes</span>
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
        <span class="text-xs text-muted-foreground">Diagnostics</span>
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
            updateNumberOverride(
              "maxConcurrentHeavyChecks",
              (event.currentTarget as HTMLInputElement).value,
            )}
        />
      </label>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="grid gap-1">
        <span class="text-xs text-muted-foreground">Metrics reads</span>
        <select
          aria-label="Metrics reads policy"
          class="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={effectiveBudget.metricsReadPolicy}
          onchange={(event) =>
            updateOverride({
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
          aria-label="Capability discovery mode"
          class="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={effectiveBudget.capabilityDiscoveryMode}
          onchange={(event) =>
            updateOverride({
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
    </div>

    <div class="grid gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <label class="flex items-center justify-between gap-3">
        <span>Resource sync</span>
        <input
          aria-label="Resource sync"
          type="checkbox"
          checked={effectiveResourceSyncEnabled}
          onchange={(event) =>
            updateBooleanOverride("resourceSyncEnabled", (event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <label class="flex items-center justify-between gap-3">
        <span>Diagnostics</span>
        <input
          aria-label="Diagnostics"
          type="checkbox"
          checked={effectiveDiagnosticsEnabled}
          onchange={(event) =>
            updateBooleanOverride("diagnosticsEnabled", (event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <label class="flex items-center justify-between gap-3">
        <span>Metrics</span>
        <input
          aria-label="Metrics"
          type="checkbox"
          checked={effectiveMetricsEnabled}
          onchange={(event) =>
            updateBooleanOverride("metricsEnabled", (event.currentTarget as HTMLInputElement).checked)}
        />
      </label>
      <label class="flex items-center justify-between gap-3">
        <span>Capability discovery</span>
        <input
          aria-label="Capability discovery"
          type="checkbox"
          checked={effectiveCapabilityDiscoveryEnabled}
          onchange={(event) =>
            updateBooleanOverride(
              "capabilityDiscoveryEnabled",
              (event.currentTarget as HTMLInputElement).checked,
            )}
        />
      </label>
      <label class="flex items-center justify-between gap-3">
        <span>Auto-suspend inactive</span>
        <input
          aria-label="Auto-suspend inactive"
          type="checkbox"
          checked={effectiveBudget.autoSuspendInactiveClusters}
          onchange={(event) =>
            updateOverride({
              autoSuspendInactiveClusters: (event.currentTarget as HTMLInputElement).checked,
            })}
        />
      </label>
    </div>
  </div>

  <div class="rounded-md border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
    <div>
      Profile budget: {baseBudget.maxConcurrentConnections} conn / {baseBudget.maxConcurrentClusterRefreshes} refresh / {baseBudget.maxConcurrentDiagnostics} diag
    </div>
    <div>
      Effective budget: {effectiveBudget.maxConcurrentConnections} conn / {effectiveBudget.maxConcurrentClusterRefreshes} refresh / {effectiveBudget.maxConcurrentDiagnostics} diag
    </div>
    <div>
      Policy: {effectiveBudget.metricsReadPolicy} metrics / {effectiveBudget.capabilityDiscoveryMode} capability
    </div>
  </div>

  <div class="flex items-center justify-between gap-2">
    <span class="text-xs text-muted-foreground">
      {#if override}
        Custom override active
      {:else}
        Inheriting shared profile
      {/if}
    </span>
    <Button variant="outline" size="sm" onclick={() => clearClusterRuntimeOverride(clusterId)}>
      Reset override
    </Button>
  </div>
</div>
