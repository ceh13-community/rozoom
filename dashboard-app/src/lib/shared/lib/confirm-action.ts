import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { hasConfirmHost, requestConfirm } from "./confirm-dialog.svelte";
import { isTauriAvailable } from "./tauri-runtime";

/**
 * Asks before an action and resolves true only on an explicit confirm.
 *
 * The in-app dialog (ConfirmDialogHost in the root layout) answers it in every window that
 * mounts the layout. A webview without the host falls back to the system dialog, so the
 * question is always shown somewhere and never answered Yes on its own.
 */
export async function confirmAction(message: string, title = "Confirm"): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (hasConfirmHost()) return requestConfirm({ title, message });
  if (isTauriAvailable()) {
    try {
      return await tauriConfirm(message, {
        title,
        kind: "warning",
      });
    } catch {
      return window.confirm(message);
    }
  }
  return window.confirm(message);
}
