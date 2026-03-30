<script lang="ts">
  interface Props {
    title: string;
  }

  let { title, children }: Props & { children?: import("svelte").Snippet } = $props();
</script>

<div class="rounded-lg border border-border/60 bg-background/40 p-4">
  <p class="text-sm text-muted-foreground">{title}</p>
  <div class="mt-1 space-y-1">
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>
