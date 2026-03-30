<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.spec?.volumes}
  <Table.Row>
    <Table.Cell>Secrets</Table.Cell>
    <Table.Cell>
      {#each selectedItem.spec.volumes as volume}
        <div class="flex items-center">
          {#if "secret" in volume}
            <span class="mr-1">{volume.secret.secretName}</span>
          {/if}
        </div>
      {/each}
    </Table.Cell>
  </Table.Row>
{/if}
