<script lang="ts">
  import { ResourceMapPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<ResourceMapPanel clusterId={data.uuid} />
