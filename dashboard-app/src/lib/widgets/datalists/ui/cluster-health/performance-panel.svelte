<script lang="ts">
  import PerformancePanel from "$widgets/cluster/ui/performance-panel.svelte";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<PerformancePanel clusterId={data.uuid} />
