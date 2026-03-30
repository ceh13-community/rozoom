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

{#if $selectedItem?.spec?.template?.spec?.affinity?.nodeAffinity}
  <Table.Row onclick={() => toggleExpand("labels")} class="cursor-pointer">
    <Table.Cell>
      <div class="flex items-center">
        <span>Node Affinities</span>
        {#if Object.keys($selectedItem.spec.template.spec.affinity.nodeAffinity).length > 0}
          {#if $expandedFields.has("labels")}
            <ChevronUp class="h-4 w-4" />
          {:else}
            <ChevronDown class="h-4 w-4" />
          {/if}
        {/if}
      </div>
    </Table.Cell>
    <Table.Cell>
      {#if $expandedFields.has("labels")}
        <pre>{JSON.stringify($selectedItem.spec.template.spec.affinity.nodeAffinity, null, 2)}</pre>
      {:else}
        {Object.keys($selectedItem.spec.template.spec.affinity.nodeAffinity).length} Rule(s)
      {/if}
    </Table.Cell>
  </Table.Row>
{/if}
