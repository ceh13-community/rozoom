<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.status?.podIP}
  <Table.Row>
    <Table.Cell>IP</Table.Cell>
    <Table.Cell>{selectedItem.status.podIP}</Table.Cell>
  </Table.Row>
{/if}
{#if selectedItem?.status?.podIPs}
  <Table.Row>
    <Table.Cell>IPs</Table.Cell>
    <Table.Cell>
      {#each selectedItem.status.podIPs as ip}
        <div class="flex items-center">
          <span class="mr-1">{ip.ip}</span>
        </div>
      {/each}
    </Table.Cell>
  </Table.Row>
{/if}
