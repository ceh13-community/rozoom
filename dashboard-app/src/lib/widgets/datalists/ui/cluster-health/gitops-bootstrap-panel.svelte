<script lang="ts">
  import GitopsBootstrapPanel from "$widgets/cluster/ui/gitops-bootstrap-panel.svelte";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<GitopsBootstrapPanel clusterId={data.uuid} />
