/**
 * Keyboard shortcut handler for the Manage Kubernetes Clusters page.
 * Kept as a pure helper so the page can install the listener once in
 * onMount and remove it in onDestroy without sprinkling logic throughout
 * the template.
 *
 * Design:
 *   - shortcuts only fire when no input/textarea/contenteditable is focused
 *   - Escape is an exception: it fires even from an input (to clear it)
 *   - returns a disposer so the caller can cleanly detach the listener
 */

export type ShortcutHandlers = {
  focusSearch: () => void;
  clearSearch: () => void;
  toggleEnv: (env: "prod" | "stage" | "dev") => void;
  clearFleetFilter: () => void;
  toggleHelp: () => void;
  hasActiveFilter: () => boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // jsdom does not compute isContentEditable for detached nodes; fall back
  // to the attribute so tests and realistic portal-rendered editors both
  // get treated as typing targets.
  const attr = target.getAttribute("contenteditable");
  return attr === "" || attr === "true";
}

/** The set of keys the handler intercepts; exported for tests/docs. */
export const SHORTCUTS: ReadonlyArray<{
  keys: string;
  description: string;
}> = [
  { keys: "/", description: "Focus search" },
  { keys: "p", description: "Filter env: prod" },
  { keys: "s", description: "Filter env: stage" },
  { keys: "d", description: "Filter env: dev" },
  { keys: "Esc", description: "Clear search / filter" },
  { keys: "?", description: "Show this help" },
];

/**
 * Decide what to do for a single keydown event. Returns true when the
 * event was handled (caller should preventDefault).
 */
export function dispatchShortcut(event: KeyboardEvent, handlers: ShortcutHandlers): boolean {
  if (event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;

  const typing = isTypingTarget(event.target);

  // Escape works everywhere - clear search first, then fleet filter.
  if (event.key === "Escape") {
    if (typing && event.target instanceof HTMLInputElement) {
      if (event.target.value) {
        handlers.clearSearch();
        return true;
      }
    }
    if (!typing && handlers.hasActiveFilter()) {
      handlers.clearFleetFilter();
      return true;
    }
    return false;
  }

  if (typing) return false;

  switch (event.key) {
    case "/":
      handlers.focusSearch();
      return true;
    case "p":
    case "P":
      handlers.toggleEnv("prod");
      return true;
    case "s":
    case "S":
      handlers.toggleEnv("stage");
      return true;
    case "d":
    case "D":
      handlers.toggleEnv("dev");
      return true;
    case "?":
      handlers.toggleHelp();
      return true;
    default:
      return false;
  }
}
