<script lang="ts">
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

{#if $selectedItem?.spec?.selector?.matchLabels}
  <Table.Row>
    <Table.Cell>Selector</Table.Cell>
    <Table.Cell>
      {Object.entries($selectedItem.spec.selector.matchLabels)
        .map(([key, value]) => `${key}=${value};`)
        .join(" ")}
    </Table.Cell>
  </Table.Row>
{/if}
