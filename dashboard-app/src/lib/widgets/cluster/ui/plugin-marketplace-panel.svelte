<script lang="ts">
  import {
    BUILTIN_PLUGINS,
    isPluginActive,
    getTrialDaysRemaining,
    togglePlugin,
    type PluginManifest,
  } from "$shared/plugins";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";

  const categories = [...new Set(BUILTIN_PLUGINS.map((p) => p.category))].sort();

  let filterCategory = $state<string>("all");
  let filterTier = $state<string>("all");

  const filtered = $derived(
    BUILTIN_PLUGINS.filter((p) => {
      if (filterCategory !== "all" && p.category !== filterCategory) return false;
      if (filterTier !== "all" && p.tier !== filterTier) return false;
      return true;
    }),
  );

  const tierIcon: Record<string, string> = {
    core: "",
    free: "",
    pro: "PRO",
    community: "",
  };

  const tierColor: Record<string, string> = {
    core: "bg-slate-500/20 text-slate-300",
    free: "bg-emerald-500/20 text-emerald-300",
    pro: "bg-indigo-500/20 text-indigo-300",
    community: "bg-amber-500/20 text-amber-300",
  };

  function formatPrice(p: PluginManifest): string {
    if (!p.pricing || p.pricing.type === "free") return "Free";
    return `$${p.pricing.amount}/${p.pricing.type === "monthly" ? "mo" : "yr"}`;
  }
</script>

<Card.Root class="border-slate-700 bg-slate-800/60">
  <Card.Header class="pb-2">
    <Card.Title class="text-sm">Plugin Marketplace</Card.Title>
    <p class="text-[10px] text-slate-500 mt-0.5">
      Extend ROZOOM with security, capacity, performance, and integration modules.
    </p>
  </Card.Header>
  <Card.Content class="space-y-3 text-xs">
    <!-- Filters -->
    <div class="flex gap-2 flex-wrap">
      <select
        bind:value={filterTier}
        class="h-6 text-[10px] px-1.5 rounded border border-slate-600 bg-slate-900/50 text-slate-300"
      >
        <option value="all">All tiers</option>
        <option value="core">Core</option>
        <option value="free">Free</option>
        <option value="free">Community</option>
      </select>
      <select
        bind:value={filterCategory}
        class="h-6 text-[10px] px-1.5 rounded border border-slate-600 bg-slate-900/50 text-slate-300"
      >
        <option value="all">All categories</option>
        {#each categories as cat}<option value={cat}>{cat}</option>{/each}
      </select>
      <span class="text-[10px] text-slate-500 ml-auto">{filtered.length} plugins</span>
    </div>

    <!-- Plugin grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {#each filtered as plugin (plugin.id)}
        {@const active = isPluginActive(plugin)}
        {@const trialDays = getTrialDaysRemaining(plugin)}
        <div
          class="rounded-lg border {active
            ? 'border-slate-600'
            : 'border-slate-700 opacity-60'} bg-slate-900/40 p-3 space-y-1.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-semibold text-slate-200 text-xs">{plugin.name}</span>
                <span class="text-[9px] px-1.5 py-0.5 rounded-full {tierColor[plugin.tier]}"
                  >{plugin.tier}</span
                >
              </div>
              <p class="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{plugin.description}</p>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-slate-500">{plugin.category}</span>
            </div>

            {#if plugin.tier === "core"}
              <span class="text-[10px] text-slate-600">Always on</span>
            {:else}
              <Button
                size="sm"
                variant={active ? "outline" : "default"}
                class="text-[10px] h-5 px-2"
                onclick={() => togglePlugin(plugin.id)}
              >
                {active ? "Disable" : "Enable"}
              </Button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </Card.Content>
</Card.Root>
