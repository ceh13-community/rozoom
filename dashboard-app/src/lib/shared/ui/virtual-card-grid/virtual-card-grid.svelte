<script lang="ts" generics="T">
  import { onMount, onDestroy, type Snippet } from "svelte";

  interface Props {
    items: T[];
    estimatedCardHeight?: number;
    gap?: number;
    overscan?: number;
    children: Snippet<[{ item: T; index: number }]>;
    class?: string;
  }

  const {
    items,
    estimatedCardHeight = 620,
    gap = 16,
    overscan = 4,
    children,
    class: className = "",
  }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let scrollY = $state(0);
  let viewportHeight = $state(800);
  let columns = $state(4);

  const rowHeight = $derived(estimatedCardHeight + gap);
  const totalRows = $derived(Math.ceil(items.length / columns));
  const totalHeight = $derived(totalRows * rowHeight);

  const visibleStartRow = $derived(Math.max(0, Math.floor(scrollY / rowHeight) - overscan));
  const visibleEndRow = $derived(
    Math.min(totalRows, Math.ceil((scrollY + viewportHeight) / rowHeight) + overscan),
  );
  const visibleStartIndex = $derived(visibleStartRow * columns);
  const visibleEndIndex = $derived(Math.min(items.length, visibleEndRow * columns));
  const visibleItems = $derived(
    items.slice(visibleStartIndex, visibleEndIndex).map((item, i) => ({
      item,
      index: visibleStartIndex + i,
    })),
  );
  const paddingTop = $derived(visibleStartRow * rowHeight);
  const paddingBottom = $derived(Math.max(0, (totalRows - visibleEndRow) * rowHeight));

  function updateColumns() {
    if (!containerEl) return;
    const width = containerEl.clientWidth;
    if (width >= 1280) columns = 4;
    else if (width >= 1024) columns = 3;
    else if (width >= 768) columns = 2;
    else columns = 1;
  }

  function onScroll() {
    scrollY = window.scrollY;
  }

  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    scrollY = window.scrollY;
    viewportHeight = window.innerHeight;
    updateColumns();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      viewportHeight = window.innerHeight;
    });

    if (containerEl) {
      resizeObserver = new ResizeObserver(() => updateColumns());
      resizeObserver.observe(containerEl);
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", onScroll);
    }
    resizeObserver?.disconnect();
  });
</script>

<div bind:this={containerEl} class={className} style="position: relative;">
  <div style="height: {totalHeight}px; position: relative;">
    <div
      style="
        position: absolute;
        top: {paddingTop}px;
        left: 0;
        right: 0;
      "
    >
      <div
        class="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {#each visibleItems as entry (entry.index)}
          {@render children(entry)}
        {/each}
      </div>
    </div>
  </div>
</div>
