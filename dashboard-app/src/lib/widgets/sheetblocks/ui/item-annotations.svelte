<script lang="ts">
  import { writable } from "svelte/store";
  import { ChevronDown, ChevronUp } from "$shared/ui/icons";
  import * as Table from "$shared/ui/table";

  export let selectedItem;

  const expandedFields = writable(new Set<string>());

  function toggleExpand(field: string) {
    expandedFields.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(field)) {
        newSet.delete(field);
      } else {
        newSet.add(field);
      }
      return newSet;
    });
  }
</script>

{#if selectedItem?.metadata?.annotations}
  <Table.Row onclick={() => toggleExpand("annotations")} class="cursor-pointer">
    <Table.Cell>
      <div class="flex items-center">
        <span>Annotations</span>
        {#if Object.keys(selectedItem.metadata.annotations).length > 0}
          {#if $expandedFields.has("annotations")}
            <ChevronUp class="h-4 w-4" />
          {:else}
            <ChevronDown class="h-4 w-4" />
          {/if}
        {/if}
      </div>
    </Table.Cell>
    <Table.Cell>
      {#if $expandedFields.has("annotations")}
        <pre>{JSON.stringify(selectedItem.metadata.annotations, null, 2)}</pre>
      {:else}
        {Object.keys(selectedItem.metadata.annotations).length}
      {/if}
    </Table.Cell>
  </Table.Row>
{/if}
