<script lang="ts">
  import { RotateCertsPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<RotateCertsPanel clusterId={data.uuid} />
