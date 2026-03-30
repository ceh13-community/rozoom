<script lang="ts" module>
  import type { Header } from "@tanstack/table-core";
</script>

<script lang="ts" generics="TData, TValue">
  import { SortingButton } from "$shared/ui/button";
  import FlexRender from "./flex-render.svelte";

  type Props = {
    header: Header<TData, TValue>;
  };

  let { header }: Props = $props();

  const headerTemplate = $derived(header.column.columnDef.header);
  const sortableLabel = $derived(
    typeof headerTemplate === "string" && header.column.getCanSort() ? headerTemplate : null,
  );
</script>

{#if !header.isPlaceholder}
  {#if sortableLabel}
    <SortingButton
      label={sortableLabel}
      onclick={header.column.getToggleSortingHandler()}
      aria-label={`Sort by ${sortableLabel}`}
      title={`Sort by ${sortableLabel}`}
    />
  {:else}
    <FlexRender content={headerTemplate} context={header.getContext()} />
  {/if}
{/if}
