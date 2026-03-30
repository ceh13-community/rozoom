<script lang="ts">
  import AuthSecurityPanel from "$widgets/cluster/ui/auth-security-panel.svelte";
  import { findClusterByUuid } from "$features/cluster-manager";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
  const cluster = $derived(findClusterByUuid(data.uuid));
</script>

{#if cluster}
  <AuthSecurityPanel
    clusterId={data.uuid}
    clusterName={cluster.name}
  />
{/if}
