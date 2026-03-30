<script lang="ts">
  import { getDeploymentStatus } from "$entities/deployment";
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.status?.phase}
  <Table.Row>
    <Table.Cell>Status</Table.Cell>
    <Table.Cell>{selectedItem.status.phase}</Table.Cell>
  </Table.Row>
{:else if selectedItem?.status?.conditions}
  <Table.Row>
    <Table.Cell>Status</Table.Cell>
    <Table.Cell>
      {getDeploymentStatus(selectedItem)}
    </Table.Cell>
  </Table.Row>
{/if}
