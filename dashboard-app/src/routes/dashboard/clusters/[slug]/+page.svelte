<script lang="ts">
  import { type PageData } from "$entities/cluster";
  import { ClusterPage } from "$pages/cluster/";

  let { data }: { data: PageData } = $props();
</script>

<ClusterPage {data} />
