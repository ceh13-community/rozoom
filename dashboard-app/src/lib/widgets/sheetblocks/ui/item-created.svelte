<script lang="ts">
  import { timeAgo } from "$shared";
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.metadata?.creationTimestamp}
  <Table.Row>
    <Table.Cell width="180">Created</Table.Cell>
    <Table.Cell
      >{timeAgo(new Date(selectedItem.metadata.creationTimestamp))} ({selectedItem.metadata
        .creationTimestamp})</Table.Cell
    >
  </Table.Row>
{/if}
