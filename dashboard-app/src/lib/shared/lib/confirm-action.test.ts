import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "./confirm-action";

const tauriConfirmMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: tauriConfirmMock,
}));

describe("confirm-action", () => {
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
