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

{#if selectedItem?.spec?.tolerations}
  <Table.Row onclick={() => toggleExpand("tolerations")} class="cursor-pointer">
    <Table.Cell>
      <div class="flex items-center">
        <span>Tolerations</span>
        {#if Object.keys(selectedItem.spec.tolerations).length > 0}
          {#if $expandedFields.has("tolerations")}
            <ChevronUp class="h-4 w-4" />
          {:else}
            <ChevronDown class="h-4 w-4" />
          {/if}
        {/if}
      </div>
    </Table.Cell>
    <Table.Cell>
      {#if $expandedFields.has("tolerations")}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>Key</Table.Head>
              <Table.Head>Operator</Table.Head>
              <Table.Head>Effect</Table.Head>
              <Table.Head>Toleration Seconds</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each selectedItem.spec.tolerations as toleration}
              <Table.Row>
                <Table.Cell>{toleration.key}</Table.Cell>
                <Table.Cell>{toleration.operator}</Table.Cell>
                <Table.Cell>{toleration.effect}</Table.Cell>
                <Table.Cell>{toleration.tolerationSeconds}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {:else}
        {Object.keys(selectedItem.spec.tolerations).length}
      {/if}
    </Table.Cell>
  </Table.Row>
{/if}
