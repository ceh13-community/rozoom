import { confirm as tauriConfirm } from "@tauri-apps/plugin-dialog";
import { isTauriAvailable } from "./tauri-runtime";

export async function confirmAction(message: string, title = "Confirm"): Promise<boolean> {
  if (typeof window === "undefined") return false;
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
