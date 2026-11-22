<script lang="ts">
  import type { Snippet } from "svelte";
  import { getWorkbenchHeaderClasses } from "$features/pods-workbench";

  interface WorkbenchHeaderProps {
    tabs: Array<{ id: string } & any>;
    renderTab: Snippet<[any]>;
    controls?: Snippet;
    /** Kept fully in view, with its pin, actions and close buttons, when the row scrolls. */
    activeTabId?: string | null;
  }

  let { tabs, renderTab, controls, activeTabId = null }: WorkbenchHeaderProps = $props();
  const classes = getWorkbenchHeaderClasses();
  let viewport = $state<HTMLDivElement | null>(null);

  // The tab row scrolls sideways when the tabs do not fit (two wide tabs at 1246 px): the
  // active tab's close button could sit outside it. Scroll the row (only the row, never the
  // page) so the whole active tab shows.
  $effect(() => {
    const id = activeTabId;
    void tabs.length;
    const row = viewport;
    if (!id || !row) return;
    const item = Array.from(row.querySelectorAll<HTMLElement>("[data-workbench-tab]")).find(
      (element) => element.dataset.workbenchTab === id,
    );
    if (!item) return;
    // Position of the tab inside the scrolled row content.
    const left =
      item.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
    const right = left + item.getBoundingClientRect().width;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.min(left, right - row.clientWidth);
    }
  });
</script>

<div class={classes.root}>
  <div class={classes.scrollViewport} bind:this={viewport}>
    <div class={classes.tabsRow}>
      {#each tabs as tab (tab.id)}
        <div class={classes.tabItem} data-workbench-tab={tab.id}>
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
