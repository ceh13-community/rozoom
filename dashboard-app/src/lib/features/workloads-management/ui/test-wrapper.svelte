<script lang="ts">
  import { createWorkloadsStore } from "../model/workloads-store.svelte";

  let { params } = $props();
  // svelte-ignore state_referenced_locally
  let store = createWorkloadsStore(params);

  export { store };
</script>
