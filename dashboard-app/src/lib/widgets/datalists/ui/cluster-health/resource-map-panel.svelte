<script lang="ts">
  import { setSelectedNamespace } from "$features/namespace-management";
  import { ResourceMapPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string; slug: string };
  }

  const { data }: Props = $props();
</script>

<!-- The map lists every namespace: a jump selects the resource's namespace, keyed like
     the namespace selector, so the list shows that resource and not a namesake. -->
<ResourceMapPanel
  clusterId={data.uuid}
  onSelectNamespace={(namespace) => setSelectedNamespace(data.slug, namespace)}
/>
