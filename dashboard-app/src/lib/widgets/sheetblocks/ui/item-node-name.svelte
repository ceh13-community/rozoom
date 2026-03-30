<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.spec?.nodeName}
  <Table.Row>
    <Table.Cell>Node</Table.Cell>
    <Table.Cell>{selectedItem.spec.nodeName}</Table.Cell>
  </Table.Row>
{/if}
