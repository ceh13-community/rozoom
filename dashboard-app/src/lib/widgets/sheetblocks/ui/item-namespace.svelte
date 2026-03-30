<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if $selectedItem?.metadata?.namespace}
  <Table.Row>
    <Table.Cell>Namespace</Table.Cell>
    <Table.Cell>{$selectedItem.metadata.namespace}</Table.Cell>
  </Table.Row>
{/if}
