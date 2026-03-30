<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if selectedItem?.spec?.nodeSelector}
  <Table.Row>
    <Table.Cell>Node Selector</Table.Cell>
    <Table.Cell>
      {#each Object.entries(selectedItem.spec.nodeSelector) as [key, value]}
        <span class="mr-2">{key}: {value};</span>
      {/each}
    </Table.Cell>
  </Table.Row>
{:else if selectedItem?.spec?.template?.spec?.nodeSelector}
  <Table.Row>
    <Table.Cell>Node Selector</Table.Cell>
    <Table.Cell>
      {Object.entries(selectedItem.spec.template.spec.nodeSelector)
        .map(([key, value]) => `${key}=${value};`)
        .join(" ")}
    </Table.Cell>
  </Table.Row>
{/if}
