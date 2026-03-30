<script lang="ts">
  type SummaryItem = {
    label: string;
    value: string | number;
  };

  interface Props {
    items: SummaryItem[];
    querySlotClass?: string;
  }

  let { items, querySlotClass = "ml-auto min-w-[18rem] flex-1", children }: Props & { children?: import("svelte").Snippet } = $props();
</script>

<div class="flex flex-wrap items-center gap-3 px-1 py-1 text-sm">
  {#each items as item (item.label)}
    <div class="text-sm text-muted-foreground">
      {item.label}: <span class="font-medium text-foreground">{item.value}</span>
    </div>
  {/each}
  {#if children}
    <div class={querySlotClass}>
      {@render children()}
    </div>
  {/if}
</div>
