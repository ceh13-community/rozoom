<script lang="ts">
  import { Button } from "$shared/ui/button";
  import { Input } from "$shared/ui/input";

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
</script>

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
    oninput={(event) => {
      const raw = Number(event.currentTarget.value);
      if (!Number.isFinite(raw)) return;
      onWatcherRefreshSecondsChange(raw);
    }}
  />
</div>
{#if showRefreshButton && onRefresh}
  <Button variant="outline" size="sm" onclick={() => onRefresh?.()}>
    {refreshButtonLabel}
  </Button>
{/if}
<Button variant="outline" size="sm" onclick={() => onResetWatcherSettings()}>
  Reset
</Button>
