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
  // page) so the whole active tab shows: after the next frame (its buttons render then) and
  // whenever the tabs or the row change size.
  function revealActiveTab() {
    const row = viewport;
    const id = activeTabId;
    if (!id || !row) return;
    const item = Array.from(row.querySelectorAll<HTMLElement>("[data-workbench-tab]")).find(
      (element) => element.dataset.workbenchTab === id,
    );
    if (!item) return;
    const rowRect = row.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    // Position of the tab inside the scrolled row content.
    const left = itemRect.left - rowRect.left + row.scrollLeft;
    const right = left + itemRect.width;
    if (left < row.scrollLeft) row.scrollLeft = left;
    else if (right > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = Math.min(left, right - row.clientWidth);
    }
  }

  $effect(() => {
    void activeTabId;
    void tabs.length;
    const frame = requestAnimationFrame(revealActiveTab);
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  $effect(() => {
    const row = viewport;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      revealActiveTab();
    });
    observer.observe(row);
    if (row.firstElementChild) observer.observe(row.firstElementChild);
    return () => {
      observer.disconnect();
    };
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
