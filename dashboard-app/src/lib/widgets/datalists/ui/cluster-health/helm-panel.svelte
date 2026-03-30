<script lang="ts">
  import { HelmPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<HelmPanel clusterId={data.uuid} />
