<script lang="ts">
  import {
    ItemAnnotations,
    ItemConditions,
    ItemCreated,
    ItemLabels,
    ItemName,
    ItemNodeName,
    ItemNodeSelector,
    ItemOwnerReferences,
    ItemPodIp,
    ItemQosClass,
    ItemSecrets,
    ItemServiceAccount,
    ItemStatus,
    ItemTolerations,
  } from "$widgets/sheetblocks";
  import * as Table from "$shared/ui/table";

  export let selectedItem;
</script>

<Table.Root>
  <Table.Body>
    <ItemCreated {selectedItem} />
    <ItemName {selectedItem} />
    <ItemLabels {selectedItem} />
    <ItemAnnotations {selectedItem} />
    <ItemOwnerReferences {selectedItem} />
    <ItemStatus {selectedItem} />
    <ItemNodeName {selectedItem} />
    <ItemPodIp {selectedItem} />
    <ItemServiceAccount {selectedItem} />
    <ItemQosClass {selectedItem} />
    <ItemConditions {selectedItem} />
    <ItemNodeSelector {selectedItem} />
    <ItemTolerations {selectedItem} />
    <ItemSecrets {selectedItem} />
  </Table.Body>
</Table.Root>
