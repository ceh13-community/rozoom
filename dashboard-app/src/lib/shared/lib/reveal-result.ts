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

/**
 * True when the person is typing in a field outside `root`. The result of a row action
 * arrives after a cluster request; by then they may have moved on to a filter or a form,
 * and a reveal would pull the caret and the page away from what they type.
 */
export function isTypingOutside(active: Element | null, root: Element): boolean {
  if (!(active instanceof HTMLElement) || root.contains(active)) return false;
  if (active.isContentEditable) return true;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
  if (!(active instanceof HTMLInputElement)) return false;
  return ![
    "button",
    "checkbox",
    "radio",
    "submit",
    "reset",
    "image",
    "file",
    "range",
    "color",
  ].includes(active.type);
}

/** Focus the element that had it before, when it is still on the page. */
export function restoreFocus(trigger: Element | null | undefined): boolean {
  if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return false;
  if (trigger === document.body) return false;
  trigger.focus({ preventScroll: true });
  return true;
}
