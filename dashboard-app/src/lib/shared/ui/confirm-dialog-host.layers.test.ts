import { fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet, tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialogHost from "./confirm-dialog-host.svelte";
import DetailsSheetPortal from "./details-sheet-portal.svelte";
import { confirmAction } from "$shared/lib/confirm-action";
import { confirmDialog, settleConfirm } from "$shared/lib/confirm-dialog.svelte";
import {
  handleGlobalKeydown,
  hasOpenOverlay,
  resetKeyboardManager,
} from "$shared/lib/keyboard-manager";

const children = createRawSnippet(() => ({
  render: () => `<div><button type="button">Inside</button></div>`,
}));

// A details panel sits in the keyboard manager's overlay stack; the question is a bits-ui
// dialog above it. One Escape must answer the question and leave the panel open, the way the
// cluster page wires it: the global handler on window, the dialog's own handler on document.
describe("ConfirmDialogHost above a details panel", () => {
  afterEach(() => {
    while (confirmDialog.current) settleConfirm(false);
    resetKeyboardManager();
  });

  it("Escape answers the question only; the panel closes on the next Escape", async () => {
    const handler = (event: KeyboardEvent) => handleGlobalKeydown(event);
    window.addEventListener("keydown", handler);
    const onClose = vi.fn();
    try {
      render(DetailsSheetPortal, {
        props: { open: true, onClose, closeAriaLabel: "Close node details", children },
      });
      render(ConfirmDialogHost);
      await tick();
      expect(hasOpenOverlay()).toBe(true);

      const answer = confirmAction("Open a root shell on node minikube?", "Confirm node shell");
      await tick();
      await tick();
      const dialog = screen.getByRole("dialog");

      await fireEvent.keyDown(dialog, { key: "Escape" });
      await expect(answer).resolves.toBe(false);
      expect(onClose).not.toHaveBeenCalled();
      await tick();
      expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();

      await fireEvent.keyDown(screen.getByRole("button", { name: "Close node details" }), {
        key: "Escape",
      });
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("keydown", handler);
    }
  });
});
