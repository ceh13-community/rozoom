// In-app hover hint for navigation items. A native `title` tooltip in WebKitGTK stays on
// screen after a click until the mouse moves: a sidebar click changes the page under a
// still cursor and the old hint hangs over it. This hint hides on pointerdown, on
// leaving the item and on scroll, and never outlives the element.

const SHOW_DELAY_MS = 500;
const GAP_PX = 8;

export type HintPlacement = "right" | "bottom";
export type HintOptions = { text: string; placement?: HintPlacement } | string;

function normalize(options: HintOptions) {
  return typeof options === "string"
    ? { text: options, placement: "right" as HintPlacement }
    : { text: options.text, placement: options.placement ?? ("right" as HintPlacement) };
}

export function hint(node: HTMLElement, initial: HintOptions) {
  let { text, placement } = normalize(initial);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let bubble: HTMLDivElement | null = null;

  function place() {
    if (!bubble) return;
    const rect = node.getBoundingClientRect();
    if (placement === "bottom") {
      bubble.style.left = `${Math.round(rect.left)}px`;
      bubble.style.top = `${Math.round(rect.bottom + GAP_PX)}px`;
    } else {
      bubble.style.left = `${Math.round(rect.right + GAP_PX)}px`;
      bubble.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
      bubble.style.transform = "translateY(-50%)";
    }
  }

  function show() {
    timer = null;
    if (!text || bubble || !node.isConnected) return;
    bubble = document.createElement("div");
    bubble.setAttribute("role", "tooltip");
    bubble.dataset.testid = "hint";
    bubble.className =
      "pointer-events-none fixed z-[300] max-w-xs rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md";
    bubble.textContent = text;
    document.body.appendChild(bubble);
    place();
  }

  function hide() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    bubble?.remove();
    bubble = null;
  }

  function schedule() {
    hide();
    timer = setTimeout(show, SHOW_DELAY_MS);
  }

  node.addEventListener("pointerenter", schedule);
  node.addEventListener("pointerleave", hide);
  node.addEventListener("pointerdown", hide);
  node.addEventListener("focus", schedule);
  node.addEventListener("blur", hide);
  node.addEventListener("keydown", hide);
  window.addEventListener("scroll", hide, true);

  return {
    update(next: HintOptions) {
      ({ text, placement } = normalize(next));
      if (bubble) bubble.textContent = text;
    },
    destroy() {
      hide();
      node.removeEventListener("pointerenter", schedule);
      node.removeEventListener("pointerleave", hide);
      node.removeEventListener("pointerdown", hide);
      node.removeEventListener("focus", schedule);
      node.removeEventListener("blur", hide);
      node.removeEventListener("keydown", hide);
      window.removeEventListener("scroll", hide, true);
    },
  };
}
