<script lang="ts">
  interface Props {
    maxHeightClass?: string;
    surfaceClass?: string;
    onScroll?: (event: Event) => void;
    ref?: HTMLDivElement | null;
  }

  let {
    maxHeightClass = "max-h-[70vh]",
    surfaceClass = "rounded-lg border border-border/60 bg-background/40",
    onScroll,
    ref = $bindable(null),
    children,
  }: Props & { children?: import("svelte").Snippet } = $props();
</script>

<div class="grid w-full grid-cols-1 overflow-visible">
  <div
    bind:this={ref}
    class={`${maxHeightClass} relative overflow-auto ${surfaceClass}`}
    onscroll={onScroll}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>
