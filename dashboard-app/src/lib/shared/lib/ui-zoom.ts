import { writable, get } from "svelte/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauriAvailable } from "./tauri-runtime";
import { isMac } from "./keyboard-manager";

// Interface scale (Text size): Ctrl/Cmd + = / - / 0 and the Text size control. The webview
// zoom scales text, tables and spacing together, so layouts keep their proportions.

export const UI_ZOOM_MIN = 0.8;
export const UI_ZOOM_MAX = 1.5;
export const UI_ZOOM_STEP = 0.1;
export const UI_ZOOM_DEFAULT = 1;
export const UI_ZOOM_STORAGE_KEY = "rozoom:ui-zoom";

/** Rounds to the 10% grid and keeps the level between 80% and 150%. */
export function clampZoom(level: number): number {
  if (!Number.isFinite(level)) return UI_ZOOM_DEFAULT;
  const rounded = Math.round(level * 10) / 10;
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, rounded));
}

export function stepZoom(level: number, direction: 1 | -1): number {
  return clampZoom(level + direction * UI_ZOOM_STEP);
}

export function readStoredZoom(storage: Pick<Storage, "getItem"> | undefined): number {
  const raw = storage?.getItem(UI_ZOOM_STORAGE_KEY);
  if (raw === null || raw === undefined) return UI_ZOOM_DEFAULT;
  return clampZoom(Number(raw));
}

export const uiZoom = writable(UI_ZOOM_DEFAULT);

function browserStorage(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

async function applyToWebview(level: number): Promise<void> {
  if (!isTauriAvailable()) return;
  try {
    await getCurrentWebview().setZoom(level);
  } catch (error) {
    console.error("[ui-zoom] setZoom failed", error);
  }
}

/** Sets, remembers and applies the interface scale. Returns the level that was applied. */
export function setUiZoom(level: number): number {
  const next = clampZoom(level);
  uiZoom.set(next);
  browserStorage()?.setItem(UI_ZOOM_STORAGE_KEY, String(next));
  void applyToWebview(next);
  return next;
}

export function changeUiZoom(direction: 1 | -1): number {
  return setUiZoom(stepZoom(get(uiZoom), direction));
}

/** What a key press does to the scale, or null when it is not a zoom shortcut. */
export function zoomActionForKey(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
  isMac: boolean,
): "in" | "out" | "reset" | null {
  const modifier = isMac ? event.metaKey : event.ctrlKey;
  if (!modifier || event.altKey) return null;
  if (event.key === "=" || event.key === "+") return "in";
  if (event.key === "-" || event.key === "_") return "out";
  if (event.key === "0") return "reset";
  return null;
}

/** Restores the saved scale and listens for the zoom shortcuts. Returns the cleanup. */
export function installUiZoom(): () => void {
  if (typeof window === "undefined") return () => undefined;
  setUiZoom(readStoredZoom(browserStorage()));
  const onMac = isMac();
  const onKeydown = (event: KeyboardEvent) => {
    const action = zoomActionForKey(event, onMac);
    if (!action) return;
    event.preventDefault();
    if (action === "reset") setUiZoom(UI_ZOOM_DEFAULT);
    else changeUiZoom(action === "in" ? 1 : -1);
  };
  window.addEventListener("keydown", onKeydown);
  return () => {
    window.removeEventListener("keydown", onKeydown);
  };
}
