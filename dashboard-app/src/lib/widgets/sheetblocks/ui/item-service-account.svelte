<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.spec?.serviceAccount}
  <Table.Row>
    <Table.Cell>Service Account</Table.Cell>
    <Table.Cell>{selectedItem.spec.serviceAccount}</Table.Cell>
  </Table.Row>
{/if}
