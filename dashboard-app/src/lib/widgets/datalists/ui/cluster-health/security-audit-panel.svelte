<script lang="ts">
  import SecurityAuditPanel from "$widgets/cluster/ui/security-audit-panel.svelte";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<SecurityAuditPanel clusterId={data.uuid} />
