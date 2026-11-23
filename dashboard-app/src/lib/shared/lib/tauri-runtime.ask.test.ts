import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDialog, registerConfirmHost, settleConfirm } from "./confirm-dialog.svelte";
import { safeDialogAsk } from "./tauri-runtime";

const askMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: askMock }));

describe("safeDialogAsk", () => {
  beforeEach(() => {
    askMock.mockReset();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("asks the in-app dialog when a host is mounted, the system ask untouched", async () => {
    const unregister = registerConfirmHost();
    const browserConfirmSpy = vi.spyOn(window, "confirm");
    try {
      const answer = safeDialogAsk('Permanently delete "lab"? This cannot be undone.', {
        title: "Purge cluster",
        kind: "warning",
      });
      expect(confirmDialog.current).toMatchObject({
        title: "Purge cluster",
        message: 'Permanently delete "lab"? This cannot be undone.',
      });
      settleConfirm(false);
      await expect(answer).resolves.toBe(false);

      const restart = safeDialogAsk("Restart to update?");
      expect(confirmDialog.current?.title).toBe("Confirm");
      settleConfirm(true);
      await expect(restart).resolves.toBe(true);

      expect(askMock).not.toHaveBeenCalled();
      expect(browserConfirmSpy).not.toHaveBeenCalled();
    } finally {
      browserConfirmSpy.mockRestore();
      unregister();
    }
  });

  it("falls back to the browser confirm outside Tauri when no host is mounted", async () => {
    const browserConfirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    try {
      await expect(safeDialogAsk("Remove 2 selected clusters?")).resolves.toBe(true);
      expect(browserConfirmSpy).toHaveBeenCalledWith("Remove 2 selected clusters?");
      expect(askMock).not.toHaveBeenCalled();
    } finally {
      browserConfirmSpy.mockRestore();
    }
  });

  it("uses the system ask in the desktop runtime when no host is mounted", async () => {
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
    askMock.mockResolvedValue(true);
    await expect(
      safeDialogAsk("Restart to update?", { title: "Restart Rozoom", kind: "info" }),
    ).resolves.toBe(true);
    expect(askMock).toHaveBeenCalledWith("Restart to update?", {
      title: "Restart Rozoom",
      kind: "info",
    });
  });
});
