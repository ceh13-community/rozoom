<script lang="ts">
  import VisualizerPanel from "$shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<VisualizerPanel clusterId={data.uuid} />
