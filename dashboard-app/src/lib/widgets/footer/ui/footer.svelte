<script lang="ts">
  import { onMount } from "svelte";
  import { getClientKubectlVersion } from "$shared/api/tauri";
  import { writable } from "svelte/store";

  const kubectlVersion = writable<string | null>(null);

  onMount(async () => {
    const request = await getClientKubectlVersion();

    if (typeof request === "string") {
      kubectlVersion.set(null);
    } else {
      kubectlVersion.set(request?.clientVersion?.gitVersion);
    }
  });
</script>

<footer
  class="fixed top-0 left-[50%] translate-x-[-50%] bg-gradient-to-b from-green-800 bg-green-600 py-1 px-2 rounded-b-sm flex items-center justify-center text-xs text-white"
>
  <div class="app-name">ROZOOM - K8s Linter IDE.</div>
  {#if kubectlVersion}
    <div class="kubectl-version ml-2">
      Version of kubectl: {$kubectlVersion}
    </div>
  {/if}
</footer>
