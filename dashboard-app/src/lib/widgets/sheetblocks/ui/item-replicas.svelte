<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if $selectedItem?.spec?.replicas}
  <Table.Row>
    <Table.Cell>Replicas</Table.Cell>
    <Table.Cell
      >{$selectedItem.spec.replicas} desired; {$selectedItem.status.readyReplicas ?? 0} ready; {$selectedItem
        .status.updatedReplicas ?? 0} updated;
      {$selectedItem.status.unavailableReplicas ?? 0} unavailable;
      {$selectedItem.status.availableReplicas ?? 0} available; {$selectedItem.spec.replicas ?? 0} total</Table.Cell
    >
  </Table.Row>
{/if}
