<script lang="ts">
  type SummaryItem = {
    label: string;
    value: string | number;
    valueClass?: string;
    tone?: "default" | "foreground";
  };

  type Props = {
    items: SummaryItem[];
    trailingItem?: SummaryItem | null;
  };

  let { items, trailingItem = null }: Props = $props();

  function getToneClass(item: SummaryItem) {
    return item.tone === "foreground" ? "text-foreground" : "text-muted-foreground";
  }
</script>

<div class="flex flex-wrap items-center gap-3 px-1 py-1 text-sm">
  {#each items as item (`${item.label}:${item.value}`)}
    <div class={getToneClass(item)}>
      {item.label}: <span class={`font-medium ${item.valueClass ?? ""}`}>{item.value}</span>
    </div>
  {/each}
  {#if trailingItem}
    <div class={`ml-auto text-xs ${getToneClass(trailingItem)}`}>
      {trailingItem.label}: <span class={`font-medium ${trailingItem.valueClass ?? ""}`}>{trailingItem.value}</span>
    </div>
  {/if}
</div>
