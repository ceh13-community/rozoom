// Scroll position of the app's own scroll containers (the main pane and the cluster menu).
//
// WebKitGTK with GPU compositing scrolls these containers off the main thread. When a
// touchpad scroll is still gliding and the content under it gets shorter (another page
// opens in the same container, the menu collapses), the container keeps the old position
// past the new end: the field log had Global Triage at scroll=2171/771 and Service Chains
// at 1060/771, so the visible area sat below every element and the page looked empty.
// The layout gives each page its own <main>, and this module keeps a position that still
// lands past the end inside the content.

/** Puts scrollTop back inside the content when it points past the end. */
export function clampScrollTop(element: HTMLElement): void {
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  if (element.scrollTop > max) element.scrollTop = max;
}

/**
 * Svelte action for a scroll container: whenever the container or one of its direct
 * children changes size (a list loads, the menu collapses), scrollTop is clamped to the new
 * content height.
 */
export function keepScrollInRange(node: HTMLElement) {
  const resizeObserver = new ResizeObserver(() => {
    clampScrollTop(node);
  });
  const observeChildren = () => {
    resizeObserver.disconnect();
    resizeObserver.observe(node);
    for (const child of node.children) resizeObserver.observe(child);
  };
  const childListObserver = new MutationObserver(observeChildren);
  childListObserver.observe(node, { childList: true });
  observeChildren();
  return {
    destroy() {
      childListObserver.disconnect();
      resizeObserver.disconnect();
    },
  };
}
