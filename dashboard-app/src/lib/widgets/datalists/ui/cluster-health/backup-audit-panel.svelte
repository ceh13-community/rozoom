<script lang="ts">
  import { BackupAuditPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<BackupAuditPanel clusterId={data.uuid} />
