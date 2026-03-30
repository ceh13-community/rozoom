<script lang="ts">
  import { shellModalState } from "$features/shell";
  import ShellWindow from "./shell-window.svelte";
</script>

{#each $shellModalState as windowState, index (windowState.id)}
  <ShellWindow {windowState} windowIndex={index} />
{/each}
