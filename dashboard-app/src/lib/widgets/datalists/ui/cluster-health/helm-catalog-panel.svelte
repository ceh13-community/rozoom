<script lang="ts">
  import { HelmCatalogPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<HelmCatalogPanel clusterId={data.uuid} />
