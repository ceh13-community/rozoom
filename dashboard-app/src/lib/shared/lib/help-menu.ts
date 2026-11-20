import { listen } from "@tauri-apps/api/event";
import { isTauriAvailable } from "./tauri-runtime";
import type { UpdateCheckOutcome } from "./app-updater";

/** Event the native Help menu emits for the items the webview shows (support_logs.rs). */
export const HELP_MENU_EVENT = "help-menu";

export type HelpMenuHandlers = {
  keyboardShortcuts: () => void;
  checkForUpdates: () => void;
};

/** Listens for the native Help menu. Returns the cleanup. */
export function listenHelpMenu(handlers: HelpMenuHandlers): () => void {
  if (!isTauriAvailable()) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void listen<string>(HELP_MENU_EVENT, (event) => {
    if (event.payload === "keyboard-shortcuts") handlers.keyboardShortcuts();
    else if (event.payload === "check-for-updates") handlers.checkForUpdates();
  }).then((stop) => {
    if (disposed) stop();
    else unlisten = stop;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * Message after Help > Check for Updates. A found update speaks for itself (download
 * notification, or the release notice on Linux), so it gets none.
 */
export function updateCheckMessage(
  outcome: UpdateCheckOutcome,
  version: string,
): { kind: "success" | "error"; text: string } | null {
  if (outcome === "up-to-date")
    return { kind: "success", text: `Rozoom ${version} is up to date.` };
  if (outcome === "failed") {
    return {
      kind: "error",
      text: "Could not check for updates. Check your connection and try again; details are in the app log.",
    };
  }
  return null;
}
