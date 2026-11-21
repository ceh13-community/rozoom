<script lang="ts">
  import { setSelectedNamespace } from "$features/namespace-management";
  import VisualizerPanel from "$shared/plugins/contrib/workload-visualizer/visualizer-panel.svelte";

  interface Props {
    data: { uuid: string; slug: string };
  }

  const { data }: Props = $props();
</script>

<!-- The map lists every namespace: a jump selects the resource's namespace, keyed like
     the namespace selector, so the list shows that resource and not a namesake. -->
<VisualizerPanel
  clusterId={data.uuid}
  onSelectNamespace={(namespace) => setSelectedNamespace(data.slug, namespace)}
/>
