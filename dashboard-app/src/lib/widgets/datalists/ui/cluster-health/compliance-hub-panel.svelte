<script lang="ts">
  import { ComplianceHubPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<ComplianceHubPanel clusterId={data.uuid} />
