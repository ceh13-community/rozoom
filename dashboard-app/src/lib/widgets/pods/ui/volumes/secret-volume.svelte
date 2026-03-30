<script lang="ts">
  import { ChevronDown, ChevronUp } from "$shared/ui/icons";
  import type { SecretVolume } from "$entities/pod";
  import * as Table from "$shared/ui/table";

  let expanded = false;

  export let volumes: SecretVolume[];

  function toggleExpand() {
    expanded = !expanded;
  }
</script>

<Table.Row onclick={toggleExpand} class="cursor-pointer">
  <Table.Cell width="180">
    <div class="flex items-start">
      <span>Secret</span>
      {#if Object.keys(volumes).length}
        {#if expanded}
          <ChevronUp class="h-4 w-4" />
        {:else}
          <ChevronDown class="h-4 w-4" />
        {/if}
      {/if}
    </div>
  </Table.Cell>
  <Table.Cell>
    {#if expanded}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>Name</Table.Head>
            <Table.Head>Secret</Table.Head>
            <Table.Head>Items</Table.Head>
            <Table.Head>Default Mode</Table.Head>
            <Table.Head>Optional</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each volumes as volume}
            <Table.Row>
              <Table.Cell>{volume.name}</Table.Cell>
              <Table.Cell>{volume.secret?.secretName}</Table.Cell>
              <Table.Cell>{volume.secret?.items?.length}</Table.Cell>
              <Table.Cell>{volume.secret?.defaultMode}</Table.Cell>
              <Table.Cell>{volume.secret?.optional || "false"}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {:else}
      {volumes.length} volumes
    {/if}
  </Table.Cell>
</Table.Row>
