<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { clustersList, loadClusters } from "$features/cluster-manager";
  let isLoading = $state(true);

  onMount(async () => {
    await loadClusters();

    if ($clustersList.length) {
      isLoading = false;
      return openDashboard();
    }

    isLoading = false;

    return openClusterManager();
  });

  async function openDashboard() {
    await goto("/dashboard");
  }

  async function openClusterManager() {
    await goto("/cluster-manager");
  }
</script>
