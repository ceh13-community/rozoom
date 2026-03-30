<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.status?.qosClass}
  <Table.Row>
    <Table.Cell>QoS Class</Table.Cell>
    <Table.Cell>{selectedItem.status.qosClass}</Table.Cell>
  </Table.Row>
{/if}
