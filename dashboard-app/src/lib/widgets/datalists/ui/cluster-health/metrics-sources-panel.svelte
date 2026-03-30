<script lang="ts">
  import { MetricsSourcesPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<MetricsSourcesPanel clusterId={data.uuid} />
