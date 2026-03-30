<script lang="ts">
  import { TrivyHubPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<TrivyHubPanel clusterId={data.uuid} />
