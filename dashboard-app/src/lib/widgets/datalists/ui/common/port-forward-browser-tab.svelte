<script lang="ts">
  import { Button } from "$shared/ui/button";
  import Copy from "@lucide/svelte/icons/copy";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Browser from "@lucide/svelte/icons/square-arrow-out-up-right";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";

  type Props = {
    title: string;
    url: string;
    loading?: boolean;
    message?: string | null;
    onRefresh: () => void;
    onCopyUrl?: () => void;
    onOpenPreview?: () => void;
    previewLabel?: string;
    onOpenExternal?: () => void;
    onStop?: () => void;
    stopBusy?: boolean;
    stopLabel?: string;
  };

  let {
    title,
    url,
    loading = false,
    message = null,
    onRefresh,
    onCopyUrl,
    onOpenPreview,
    previewLabel = "Open Web",
    onOpenExternal,
    onStop,
    stopBusy = false,
    stopLabel = "Stop",
  }: Props = $props();
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center justify-between gap-2 border-b px-3 py-2">
    <div class="min-w-0">
      <p class="truncate text-sm font-medium">{title}</p>
      <p class="truncate font-mono text-xs text-muted-foreground">{url}</p>
    </div>
    <div class="flex items-center gap-2">
      {#if onCopyUrl}
        <Button variant="outline" size="sm" onclick={onCopyUrl}>
          <Copy class="h-4 w-4" />
          Copy URL
        </Button>
      {/if}
      {#if onOpenPreview}
        <Button variant="outline" size="sm" onclick={onOpenPreview}>
          <Browser class="h-4 w-4" />
          {previewLabel}
        </Button>
      {/if}
      {#if onOpenExternal}
        <Button variant="outline" size="sm" onclick={onOpenExternal}>
          <ExternalLink class="h-4 w-4" />
          Open external
        </Button>
      {/if}
      {#if onStop}
        <Button variant="destructive" size="sm" onclick={onStop} disabled={stopBusy}>
          {stopBusy ? stopLabel : "Stop"}
        </Button>
      {/if}
      <Button variant="outline" size="sm" onclick={onRefresh} loading={loading}>
        <RefreshCw class={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  </div>
  {#if loading}
    <div class="border-b px-3 py-2 text-xs text-muted-foreground">
      <span class="inline-flex items-center gap-1">
        <LoaderCircle class="h-3.5 w-3.5 animate-spin" />
        {message ?? "Opening web..."}
      </span>
    </div>
  {:else if message}
    <div class="border-b px-3 py-2 text-xs text-muted-foreground">{message}</div>
  {/if}
</div>
