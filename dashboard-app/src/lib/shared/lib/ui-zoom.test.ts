import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const setZoom = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom }) }));
vi.mock("./tauri-runtime", () => ({ isTauriAvailable: () => true }));

import {
  UI_ZOOM_STORAGE_KEY,
  changeUiZoom,
  clampZoom,
  installUiZoom,
  readStoredZoom,
  setUiZoom,
  stepZoom,
  uiZoom,
  zoomActionForKey,
} from "./ui-zoom";

describe("ui zoom levels", () => {
  it("keeps the scale between 80% and 150% on a 10% grid", () => {
    expect(clampZoom(0.5)).toBe(0.8);
    expect(clampZoom(2)).toBe(1.5);
    expect(clampZoom(1.24)).toBe(1.2);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("steps by 10% and stops at the limits", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.5, 1)).toBe(1.5);
    expect(stepZoom(0.8, -1)).toBe(0.8);
    // 0.1 steps in floating point: 1.2 + 0.1 must still be 1.3.
    expect(stepZoom(1.2, 1)).toBe(1.3);
  });

  it("reads a saved scale and falls back to 100%", () => {
    expect(readStoredZoom({ getItem: () => "1.3" })).toBe(1.3);
    expect(readStoredZoom({ getItem: () => null })).toBe(1);
    expect(readStoredZoom({ getItem: () => "huge" })).toBe(1);
    expect(readStoredZoom(undefined)).toBe(1);
  });
});

describe("zoom shortcuts", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...mods,
  });

  it("maps Ctrl + = / - / 0 on Linux and Windows", () => {
    expect(zoomActionForKey(key("=", { ctrlKey: true }), false)).toBe("in");
    expect(zoomActionForKey(key("+", { ctrlKey: true }), false)).toBe("in");
    expect(zoomActionForKey(key("-", { ctrlKey: true }), false)).toBe("out");
    expect(zoomActionForKey(key("0", { ctrlKey: true }), false)).toBe("reset");
  });

  it("uses Cmd on macOS and ignores plain keys and Alt", () => {
    expect(zoomActionForKey(key("=", { metaKey: true }), true)).toBe("in");
    expect(zoomActionForKey(key("=", { ctrlKey: true }), true)).toBeNull();
    expect(zoomActionForKey(key("="), false)).toBeNull();
    expect(zoomActionForKey(key("=", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(zoomActionForKey(key("k", { ctrlKey: true }), false)).toBeNull();
  });
});

describe("applying the scale", () => {
  beforeEach(() => {
    localStorage.clear();
    setZoom.mockClear();
    setUiZoom(1);
    setZoom.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("applies, remembers and publishes the new scale", () => {
    expect(changeUiZoom(1)).toBe(1.1);
    expect(get(uiZoom)).toBe(1.1);
    expect(localStorage.getItem(UI_ZOOM_STORAGE_KEY)).toBe("1.1");
    expect(setZoom).toHaveBeenLastCalledWith(1.1);
  });

  it("restores the saved scale on start and handles the shortcuts", () => {
    localStorage.setItem(UI_ZOOM_STORAGE_KEY, "1.3");
    const uninstall = installUiZoom();
    expect(setZoom).toHaveBeenLastCalledWith(1.3);

    const event = new KeyboardEvent("keydown", { key: "-", ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(get(uiZoom)).toBe(1.2);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true }));
    expect(get(uiZoom)).toBe(1);

    uninstall();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));
    expect(get(uiZoom)).toBe(1);
  });
});
