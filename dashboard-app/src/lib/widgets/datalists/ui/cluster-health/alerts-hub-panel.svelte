<script lang="ts">
  import { AlertsHubPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<AlertsHubPanel clusterId={data.uuid} />
