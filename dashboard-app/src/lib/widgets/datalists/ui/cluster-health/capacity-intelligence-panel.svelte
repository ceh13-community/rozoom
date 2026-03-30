<script lang="ts">
  import CapacityIntelligencePanel from "$widgets/cluster/ui/capacity-intelligence-panel.svelte";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<CapacityIntelligencePanel clusterId={data.uuid} />
