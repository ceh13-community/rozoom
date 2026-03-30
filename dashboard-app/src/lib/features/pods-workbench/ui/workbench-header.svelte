<script lang="ts">
  import type { Snippet } from "svelte";
  import { getWorkbenchHeaderClasses } from "$features/pods-workbench";

  interface WorkbenchHeaderProps {
    tabs: Array<{ id: string } & any>;
    renderTab: Snippet<[any]>;
    controls?: Snippet;
  }

  let { tabs, renderTab, controls }: WorkbenchHeaderProps = $props();
  const classes = getWorkbenchHeaderClasses();
</script>

<div class={classes.root}>
  <div class={classes.scrollViewport}>
    <div class={classes.tabsRow}>
      {#each tabs as tab (tab.id)}
        <div class={classes.tabItem}>
          {@render renderTab(tab)}
        </div>
      {/each}
    </div>
  </div>
  {#if controls}
    <div class={classes.controls}>
      {@render controls()}
    </div>
  {/if}
</div>
