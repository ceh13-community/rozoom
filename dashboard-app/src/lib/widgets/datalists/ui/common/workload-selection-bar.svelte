<script lang="ts">
  interface Props {
    count: number;
    label?: string;
  }

  let { count, label = "selected", children }: Props & { children?: import("svelte").Snippet } = $props();
</script>

<div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-400/30 bg-emerald-100/20 px-3 py-2">
  <div class="text-sm text-emerald-900 dark:text-emerald-200">
    {count} {label}
  </div>
  {#if children}
    <div class="flex items-center gap-2">
      {@render children()}
    </div>
  {/if}
</div>
