/**
 * Row menu action that runs once the menu has finished closing, as in the Pods menu.
 * Run right after `open = false`, the menu's own focus return to its trigger came after
 * the action and scrolled the page back to the row, away from the panel the action had
 * just revealed. The trigger gets focus without scrolling instead, so closing that panel
 * can still give focus back to it.
 */
export function createMenuAction(options: {
  close: () => void;
  getTrigger: () => HTMLElement | null;
  isBlocked?: () => boolean;
}) {
  let pendingAction: (() => void) | null = null;
  // Set for the whole close after an action: the menu may ask more than once.
  let suppressCloseFocus = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

  function runPendingAction() {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = null;
    const action = pendingAction;
    pendingAction = null;
    if (!action) return;
    options.getTrigger()?.focus({ preventScroll: true });
    action();
  }

  return {
    /** For the menu items: `onSelect={() => menuAction.select(onLogs)}`. */
    select(callback: () => void) {
      if (options.isBlocked?.()) return;
      suppressCloseFocus = true;
      pendingAction = callback;
      options.close();
      // No close event (the menu was already closing): run anyway.
      fallbackTimer = setTimeout(runPendingAction, 300);
    },
    /** For `<DropdownMenu.Content onCloseAutoFocus={menuAction.onCloseAutoFocus}>`. */
    onCloseAutoFocus(event: Event) {
      if (!suppressCloseFocus) return;
      event.preventDefault();
      if (pendingAction) setTimeout(runPendingAction, 0);
    },
    /** Call when the menu opens again: a plain close returns focus as usual. */
    reset() {
      suppressCloseFocus = false;
    },
  };
}
