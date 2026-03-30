<script lang="ts">
  import { getConditionType } from "$entities/deployment";
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.status?.conditions}
  <Table.Row>
    <Table.Cell>Conditions</Table.Cell>
    <Table.Cell>
      {#each selectedItem.status.conditions as condition}
        <span class="mr-2">{getConditionType(condition)};</span>
      {/each}
    </Table.Cell>
  </Table.Row>
{/if}
