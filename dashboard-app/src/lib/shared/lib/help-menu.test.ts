import { describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => new Map<string, (event: { payload: string }) => void>());
const unlisten = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: string }) => void) => {
    listeners.set(name, handler);
    return unlisten;
  }),
}));
vi.mock("./tauri-runtime", () => ({ isTauriAvailable: () => true }));

import { HELP_MENU_EVENT, listenHelpMenu, updateCheckMessage } from "./help-menu";

describe("help menu", () => {
  it("routes the native menu events to their handlers", async () => {
    const keyboardShortcuts = vi.fn();
    const checkForUpdates = vi.fn();
    const aboutTeam = vi.fn();
    const stop = listenHelpMenu({ keyboardShortcuts, checkForUpdates, aboutTeam });
    await Promise.resolve();

    const emit = listeners.get(HELP_MENU_EVENT);
    emit?.({ payload: "keyboard-shortcuts" });
    emit?.({ payload: "check-for-updates" });
    emit?.({ payload: "about-team" });
    emit?.({ payload: "something-else" });

    expect(keyboardShortcuts).toHaveBeenCalledTimes(1);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(aboutTeam).toHaveBeenCalledTimes(1);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("says up to date or could not check, and nothing when an update was found", () => {
    expect(updateCheckMessage("up-to-date", "0.26.5")).toEqual({
      kind: "success",
      text: "Rozoom 0.26.5 is up to date.",
    });
    expect(updateCheckMessage("failed", "0.26.5")?.kind).toBe("error");
    expect(updateCheckMessage("update-available", "0.26.5")).toBeNull();
  });
});
