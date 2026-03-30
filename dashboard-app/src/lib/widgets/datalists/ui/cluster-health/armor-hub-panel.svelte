<script lang="ts">
  import { ArmorHubPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<ArmorHubPanel clusterId={data.uuid} />
