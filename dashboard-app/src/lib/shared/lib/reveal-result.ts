/**
 * Where focus and scroll go after a row action. One place for reduced motion.
 * - revealResult: bring the panel that shows the result into view and focus it.
 * - restoreFocus: give focus back to what had it before the reveal.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function visibleHeight(target: HTMLElement): number {
  let node = target.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node.clientHeight;
    }
    node = node.parentElement;
  }
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

/** Block alignment: a panel taller than the visible area shows its top, a shorter one moves least. */
export function revealBlock(targetHeight: number, viewportHeight: number): ScrollLogicalPosition {
  return viewportHeight > 0 && targetHeight > viewportHeight ? "start" : "nearest";
}

export function revealResult(target: HTMLElement, options: { focus?: boolean } = {}) {
  const block = revealBlock(target.getBoundingClientRect().height, visibleHeight(target));
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block });
  if (options.focus ?? true) target.focus({ preventScroll: true });
}

/** Focus the element that had it before, when it is still on the page. */
export function restoreFocus(trigger: Element | null | undefined): boolean {
  if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return false;
  if (trigger === document.body) return false;
  trigger.focus({ preventScroll: true });
  return true;
}
