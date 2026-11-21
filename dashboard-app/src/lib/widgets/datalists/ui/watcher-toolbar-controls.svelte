<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";
  import { showsWatcherControls } from "./common/list-freshness";
  import { readListFreshness } from "./common/list-freshness-context.svelte";

  interface Props {
    watcherEnabled: boolean;
    watcherRefreshSeconds: number;
    refreshButtonLabel?: string;
    showRefreshButton?: boolean;
    watcherButtonActiveVariant?: "default" | "secondary" | "outline";
    onRefresh?: (() => void) | null;
    onToggleWatcher: () => void;
    onWatcherRefreshSecondsChange: (value: number) => void;
    onResetWatcherSettings: () => void;
  }

  let {
    watcherEnabled,
    watcherRefreshSeconds,
    refreshButtonLabel = "Refresh",
    showRefreshButton = false,
    watcherButtonActiveVariant = "default",
    onRefresh = null,
    onToggleWatcher,
    onWatcherRefreshSecondsChange,
    onResetWatcherSettings,
  }: Props = $props();

  // While a watch is connected, Watcher and Sync sec change nothing the user can see:
  // the list follows the cluster. They show while the list polls (no watch, or a watch
  // that dropped), while paused so it can be resumed, and in Pods, where Sync sec also
  // times CPU and Memory.
  const freshness = readListFreshness();
  const visible = $derived(!freshness || showsWatcherControls(freshness));
</script>

{#if visible}
  <Button
    variant={watcherEnabled ? watcherButtonActiveVariant : "outline"}
    size="sm"
    onclick={() => onToggleWatcher()}
  >
    {watcherEnabled ? "Watcher: On" : "Watcher: Off"}
  </Button>
  <div class="flex flex-col gap-1">
    <div class="text-xs text-muted-foreground">Sync sec</div>
    <Input
      type="number"
      min="5"
      max="600"
      step="1"
      class="w-24"
      value={String(watcherRefreshSeconds)}
      onchange={async (event) => {
        // Apply on change (Enter, blur, arrows), not per keystroke: the parent clamps to at
        // least 5 s, so applying "4" while typing "45" rewrote the field to "5" and gave "55".
        const field = event.currentTarget;
        const raw = Number(field.value);
        if (field.value.trim() !== "" && Number.isFinite(raw)) {
          onWatcherRefreshSecondsChange(raw);
        }
        // Show the value that took effect, also when clamping left the stored value unchanged.
        await tick();
        field.value = String(watcherRefreshSeconds);
      }}
    />
  </div>
  {#if showRefreshButton && onRefresh}
    <Button variant="outline" size="sm" onclick={() => onRefresh?.()}>
      {refreshButtonLabel}
    </Button>
  {/if}
  <Button variant="outline" size="sm" onclick={() => onResetWatcherSettings()}>Reset</Button>
{/if}
