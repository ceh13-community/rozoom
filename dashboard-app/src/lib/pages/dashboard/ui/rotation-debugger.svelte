<script lang="ts">
  import { Timer } from "$shared/ui/icons";
  import * as Popover from "$shared/ui/popover";
  import { autoRefreshRotation } from "$shared/lib/auto-refresh-rotation.svelte";
  import { dashboardDataProfile } from "$shared/lib/dashboard-data-profile.svelte";

  interface Props {
    filteredCount: number;
  }

  const { filteredCount }: Props = $props();

  const state = $derived($autoRefreshRotation);
  const profile = $derived($dashboardDataProfile);
  const activeCount = $derived(Math.min(state.windowSize, state.totalClusters));
  const hasRotation = $derived(state.totalClusters > state.windowSize);
  const nextRotationAtMs = $derived(hasRotation ? state.rotationIntervalMs : null);
  const windowEnd = $derived(Math.min(state.totalClusters, state.windowStart + state.windowSize));
  const wrapsAround = $derived(
    hasRotation && state.windowStart + state.windowSize > state.totalClusters,
  );
</script>

<Popover.Root>
  <Popover.Trigger>
    <button
      type="button"
      class="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700"
      title="Inspect auto-refresh rotation window"
    >
      <Timer class="h-3.5 w-3.5" />
      Rotation {activeCount}/{state.totalClusters}
    </button>
  </Popover.Trigger>
  <Popover.Content class="w-80" sideOffset={8}>
    <div class="text-sm font-semibold mb-1">Auto-refresh rotation</div>
    <div class="text-xs text-muted-foreground mb-3">
      Profile <span class="font-semibold text-foreground">{profile.label}</span> allows up to
      <span class="font-semibold text-foreground">{state.windowSize}</span> cluster cards to poll in
      parallel.
    </div>

    <dl class="grid grid-cols-2 gap-y-1 text-xs">
      <dt class="text-muted-foreground">Total cards</dt>
      <dd class="text-foreground font-medium">{state.totalClusters}</dd>

      <dt class="text-muted-foreground">Filtered visible</dt>
      <dd class="text-foreground font-medium">{filteredCount}</dd>

      <dt class="text-muted-foreground">In rotation now</dt>
      <dd class="text-foreground font-medium">
        {#if hasRotation}
          {wrapsAround
            ? `${state.windowStart}-${state.totalClusters - 1}, 0-${windowEnd - state.totalClusters - 1}`
            : `${state.windowStart}-${windowEnd - 1}`}
          <span class="text-muted-foreground">(index)</span>
        {:else}
          All cards
        {/if}
      </dd>

      {#if hasRotation && nextRotationAtMs}
        <dt class="text-muted-foreground">Window shifts every</dt>
        <dd class="text-foreground font-medium">
          {Math.round(nextRotationAtMs / 1000)}s
        </dd>
      {/if}
    </dl>

    {#if !hasRotation && state.totalClusters > 0}
      <p class="mt-3 text-[11px] text-emerald-500">
        Every card fits inside the window for this profile - no rotation needed.
      </p>
    {:else if hasRotation}
      <p class="mt-3 text-[11px] text-muted-foreground">
        Cards outside the window keep their last snapshot until the window reaches them. Switch to a
        profile with a larger rotation budget ({profile.label} -> Realtime/Fleet) or narrow the fleet
        via Views to keep every card hot.
      </p>
    {:else}
      <p class="mt-3 text-[11px] text-muted-foreground">Add clusters to see rotation status.</p>
    {/if}
  </Popover.Content>
</Popover.Root>
