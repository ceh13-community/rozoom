<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if $selectedItem?.spec?.strategy?.type}
  <Table.Row>
    <Table.Cell>Strategy Type</Table.Cell>
    <Table.Cell>{$selectedItem.spec.strategy.type}</Table.Cell>
  </Table.Row>
{/if}
