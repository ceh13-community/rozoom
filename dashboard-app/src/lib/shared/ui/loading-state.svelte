<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import LoadingDots from "./loading-dots.svelte";
  import { Skeleton } from "./skeleton";
  import { loadingElapsedLabel } from "./loading-state";

  /**
   * One loading indicator for panels that wait for the cluster: says what is happening,
   * is announced once to screen readers, and after a few seconds says it is still going.
   */
  interface Props {
    /** What is being loaded, for example "Scanning cluster resources". */
    label: string;
    /** "skeleton" keeps the height of a table or list while it loads. */
    variant?: "text" | "skeleton";
    rows?: number;
    class?: string;
  }

  let { label, variant = "text", rows = 3, class: className = "" }: Props = $props();

  const startedAt = Date.now();
  let now = $state(startedAt);
  let timer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    timer = setInterval(() => {
      now = Date.now();
    }, 1000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  const elapsed = $derived(loadingElapsedLabel(now - startedAt));
</script>

<div class={`text-sm text-muted-foreground ${className}`.trim()} role="status" aria-live="polite">
  {#if variant === "skeleton"}
    <span class="sr-only">{label}</span>
    <div class="space-y-2" aria-hidden="true">
      {#each Array.from({ length: Math.max(1, rows) }, (_, i) => i) as row (row)}
        <Skeleton class="h-8 w-full" />
      {/each}
    </div>
    {#if elapsed}<p class="mt-2 text-xs" aria-hidden="true">{label}, {elapsed}</p>{/if}
  {:else}
    <span>{label}</span><LoadingDots />
    {#if elapsed}<span class="ml-1" aria-hidden="true">{elapsed}</span>{/if}
  {/if}
</div>
