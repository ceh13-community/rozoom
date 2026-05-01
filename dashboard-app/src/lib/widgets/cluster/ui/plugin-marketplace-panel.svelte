<script lang="ts">
  import {
    BUILTIN_PLUGINS,
    disabledPlugins,
    getTrialDaysRemaining,
    isPluginActive,
    pagesHiddenByDisabling,
    pluginLicenses,
    togglePlugin,
    type PluginManifest,
  } from "$shared/plugins";
  import { confirmAction } from "$shared/lib/confirm-action";
  import { Button } from "$shared/ui/button";
  import * as Card from "$shared/ui/card";

  const categories = [...new Set(BUILTIN_PLUGINS.map((p) => p.category))].sort();

  let filterCategory = $state<string>("all");
  let filterTier = $state<string>("all");
  let query = $state<string>("");

  function matchesQuery(p: PluginManifest, q: string): boolean {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    const haystack = [p.name, p.description, p.category, p.id, ...(p.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  }

  const filtered = $derived(
    BUILTIN_PLUGINS.filter((p) => {
      if (filterCategory !== "all" && p.category !== filterCategory) return false;
      if (filterTier !== "all" && p.tier !== filterTier) return false;
      if (!matchesQuery(p, query)) return false;
      return true;
    }).sort((a, b) => {
      // Core first, then disabled non-core (so user can find what they turned
      // off), then enabled, then alphabetical.
      const tierWeight = (t: PluginManifest["tier"]) =>
        t === "core" ? 0 : t === "free" ? 1 : t === "pro" ? 2 : 3;
      const w = tierWeight(a.tier) - tierWeight(b.tier);
      if (w !== 0) return w;
      return a.name.localeCompare(b.name);
    }),
  );

  // `isPluginActive` reads the disabledPlugins / pluginLicenses stores via
  // `get()`, which Svelte 5 cannot track. Auto-subscribe here so the card
  // badges re-render as soon as the user clicks Enable / Disable.
  const activeMap = $derived.by(() => {
    void $disabledPlugins;
    void $pluginLicenses;
    const map = new Map<string, boolean>();
    for (const p of BUILTIN_PLUGINS) map.set(p.id, isPluginActive(p));
    return map;
  });

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

  /**
   * Disable: show the list of sidebar pages that will disappear so the user
   * knows exactly what they are turning off before flipping the switch.
   * Enable: no confirm needed - we are adding UI, not hiding it.
   */
  async function onToggle(plugin: PluginManifest, currentlyActive: boolean) {
    if (currentlyActive) {
      const pages = pagesHiddenByDisabling(plugin.id);
      const pageList =
        pages.length > 0
          ? `\n\nPages that will disappear from the sidebar:\n${pages.map((p) => `  - ${p.label}`).join("\n")}`
          : "";
      const confirmed = await confirmAction(
        `Disable ${plugin.name}?${pageList}\n\nThe plugin can be re-enabled here any time. No data is deleted.`,
        `Disable ${plugin.name}`,
      );
      if (!confirmed) return;
    }
    await togglePlugin(plugin.id);
  }
</script>

<div class="space-y-3">
  <Card.Root>
    <Card.Header class="pb-2">
      <Card.Title class="text-sm">Plugin Marketplace</Card.Title>
      <p class="text-xs text-muted-foreground mt-0.5">
        Enable or disable ROZOOM modules. Disabled plugins hide their sidebar entries while
        preserving their configuration and data.
      </p>
    </Card.Header>
    <Card.Content class="space-y-3">
      <!-- Filters -->
      <div class="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search plugins..."
          bind:value={query}
          class="h-7 flex-1 min-w-[160px] rounded border border-border bg-background px-2 text-xs"
        />
        <select
          bind:value={filterTier}
          class="h-7 rounded border border-border bg-background px-2 text-xs"
        >
          <option value="all">All tiers</option>
          <option value="core">Core</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="community">Community</option>
        </select>
        <select
          bind:value={filterCategory}
          class="h-7 rounded border border-border bg-background px-2 text-xs"
        >
          <option value="all">All categories</option>
          {#each categories as cat}<option value={cat}>{cat}</option>{/each}
        </select>
        <span class="text-[11px] text-muted-foreground ml-auto">
          {filtered.length} / {BUILTIN_PLUGINS.length} plugins
        </span>
      </div>

      <!-- Plugin grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {#each filtered as plugin (plugin.id)}
          {@const active = activeMap.get(plugin.id) ?? true}
          {@const trialDays = getTrialDaysRemaining(plugin)}
          {@const pages = plugin.provides.workloadPages ?? []}
          <div
            class="rounded-lg border {active
              ? 'border-border bg-background/50'
              : 'border-dashed border-border/60 bg-muted/30'} p-3 space-y-2"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-semibold text-sm">{plugin.name}</span>
                  <span class="text-[9px] px-1.5 py-0.5 rounded-full {tierColor[plugin.tier]}">
                    {plugin.tier}
                  </span>
                  {#if !active && plugin.tier !== "core"}
                    <span
                      class="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40"
                      title="Plugin is disabled. Its sidebar pages are hidden."
                    >
                      disabled
                    </span>
                  {/if}
                  {#if trialDays !== null && trialDays > 0 && plugin.tier === "pro"}
                    <span
                      class="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300"
                      >{trialDays}d trial</span
                    >
                  {/if}
                </div>
                <p class="text-xs text-muted-foreground mt-1">{plugin.description}</p>
              </div>
            </div>

            {#if pages.length > 0}
              <div class="text-[11px] text-muted-foreground">
                <span class="font-medium">Contributes:</span>
                {pages.map((p) => p.label).join(" · ")}
              </div>
            {/if}

            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-[11px] text-muted-foreground">{plugin.category}</span>
                <span class="text-[11px] text-muted-foreground">· {formatPrice(plugin)}</span>
              </div>

              {#if plugin.tier === "core"}
                <span class="text-[11px] text-muted-foreground">Always on</span>
              {:else}
                <Button
                  size="sm"
                  variant={active ? "outline" : "default"}
                  class="h-7 text-xs"
                  onclick={() => void onToggle(plugin, active)}
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
</div>
