import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "./confirm-action";
import { confirmDialog, registerConfirmHost, settleConfirm } from "./confirm-dialog.svelte";

const tauriConfirmMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: tauriConfirmMock,
}));

describe("confirm-action", () => {
  it("asks the in-app dialog when a host is mounted, system dialogs untouched", async () => {
    const unregister = registerConfirmHost();
    const browserConfirmSpy = vi.spyOn(window, "confirm");
    try {
      const answer = confirmAction("Stop this port-forward?", "Stop port-forward");
      expect(confirmDialog.current).toMatchObject({
        title: "Stop port-forward",
        message: "Stop this port-forward?",
      });
      settleConfirm(true);
      await expect(answer).resolves.toBe(true);

      const declined = confirmAction("Close this tab?");
      expect(confirmDialog.current?.title).toBe("Confirm");
      settleConfirm(false);
      await expect(declined).resolves.toBe(false);

      expect(tauriConfirmMock).not.toHaveBeenCalled();
      expect(browserConfirmSpy).not.toHaveBeenCalled();
    } finally {
      browserConfirmSpy.mockRestore();
      unregister();
    }
  });

  beforeEach(() => {
    tauriConfirmMock.mockReset();
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
    delete (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke?: unknown;
          transformCallback?: unknown;
          metadata?: unknown;
        };
      }
    ).__TAURI_INTERNALS__;
  });

  it("uses tauri confirm in desktop runtime", async () => {
    (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: () => Promise<void>;
          transformCallback: () => number;
          metadata: { currentWindow: { label: string } };
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: async () => undefined,
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" } },
    };
    tauriConfirmMock.mockResolvedValue(true);

    const result = await confirmAction("Stop this port-forward?", "Stop port-forward");

    expect(result).toBe(true);
    expect(tauriConfirmMock).toHaveBeenCalledWith("Stop this port-forward?", {
      title: "Stop port-forward",
      kind: "warning",
    });
  });

  it("falls back to browser confirm when tauri confirm fails", async () => {
    (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: () => Promise<void>;
          transformCallback: () => number;
          metadata: { currentWindow: { label: string } };
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: async () => undefined,
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" } },
    };
    tauriConfirmMock.mockRejectedValue(new Error("dialog failure"));
    const browserConfirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    const result = await confirmAction("Stop this port-forward?");

    expect(result).toBe(false);
    expect(browserConfirmSpy).toHaveBeenCalledWith("Stop this port-forward?");
    browserConfirmSpy.mockRestore();
  });

  it("treats invoke-only browser mocks as non-tauri runtime", async () => {
    (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke: () => Promise<void>;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: async () => undefined,
    };
    const browserConfirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);

    const result = await confirmAction("Stop this port-forward?");

    expect(result).toBe(true);
    expect(tauriConfirmMock).not.toHaveBeenCalled();
    expect(browserConfirmSpy).toHaveBeenCalledWith("Stop this port-forward?");
    browserConfirmSpy.mockRestore();
  });
});
