<script lang="ts">
  import { VersionAuditPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<VersionAuditPanel clusterId={data.uuid} />
