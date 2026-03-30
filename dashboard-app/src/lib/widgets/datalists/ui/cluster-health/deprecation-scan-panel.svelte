<script lang="ts">
  import { DeprecationScanPanel } from "$widgets/cluster";

  interface Props {
    data: { uuid: string };
  }

  const { data }: Props = $props();
</script>

<DeprecationScanPanel clusterId={data.uuid} />
