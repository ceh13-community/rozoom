<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.metadata?.ownerReferences}
  <Table.Row>
    <Table.Cell>Owner References</Table.Cell>
    <Table.Cell>
      {#each selectedItem.metadata.ownerReferences as ownerReference}
        <div class="flex items-center">
          <span class="mr-1">{ownerReference.kind}</span>
          <span class="mr-1">{ownerReference.name}</span>
        </div>
      {/each}
    </Table.Cell>
  </Table.Row>
{/if}
