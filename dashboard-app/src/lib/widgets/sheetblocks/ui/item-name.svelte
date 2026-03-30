<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.metadata?.name}
  <Table.Row>
    <Table.Cell>Name</Table.Cell>
    <Table.Cell>{selectedItem.metadata.name}</Table.Cell>
  </Table.Row>
{/if}
