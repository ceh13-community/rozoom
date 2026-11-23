import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ConfirmDialogHost from "./confirm-dialog-host.svelte";
import { confirmAction } from "$shared/lib/confirm-action";
import { confirmDialog, settleConfirm } from "$shared/lib/confirm-dialog.svelte";

function settled(promise: Promise<boolean>): Promise<boolean | "pending"> {
  return Promise.race([promise, new Promise<"pending">((r) => setTimeout(() => r("pending"), 0))]);
}

// Wrapped in an object: an async function would adopt the answer and wait for it.
async function openDialog(message = "Stop this port-forward?", title = "Stop port-forward") {
  const answer = confirmAction(message, title);
  await tick();
  await tick();
  return { answer };
}

describe("ConfirmDialogHost", () => {
  afterEach(() => {
    while (confirmDialog.current) settleConfirm(false);
  });

  it("shows the title and the message and starts with focus on Cancel", async () => {
    render(ConfirmDialogHost);
    const { answer } = await openDialog(
      "Stop this port-forward?\nThe tunnel closes.",
      "Stop port-forward",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Stop port-forward")).toBeInTheDocument();
    expect(screen.getByText(/The tunnel closes\./)).toBeInTheDocument();
    await tick();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(answer).resolves.toBe(false);
  });

  it("Confirm answers Yes and the dialog goes away", async () => {
    render(ConfirmDialogHost);
    const { answer } = await openDialog();
    await fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await expect(answer).resolves.toBe(true);
    await tick();
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("Escape answers No", async () => {
    render(ConfirmDialogHost);
    const { answer } = await openDialog();
    await fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await expect(answer).resolves.toBe(false);
  });

  it("a click outside the dialog answers No", async () => {
    render(ConfirmDialogHost);
    const { answer } = await openDialog();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    try {
      // The dialog listens for outside pointers a moment after it opens, and a pointer at
      // 0,0 would sit inside the dialog's (zero-sized) box in jsdom.
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fireEvent.pointerDown(outside, {
        pointerType: "mouse",
        button: 0,
        clientX: 5,
        clientY: 5,
      });
      await expect(answer).resolves.toBe(false);
    } finally {
      outside.remove();
    }
  });

  it("Enter answers only from the focused button", async () => {
    render(ConfirmDialogHost);
    const { answer } = await openDialog();
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });

    await fireEvent.keyDown(dialog, { key: "Enter" });
    await expect(settled(answer)).resolves.toBe("pending");

    confirm.focus();
    const keydown = await fireEvent.keyDown(confirm, { key: "Enter" });
    expect(keydown).toBe(false);
    await expect(answer).resolves.toBe(true);

    const { answer: second } = await openDialog("Close this tab?", "Close tab");
    cancel.focus();
    await fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Enter" });
    await expect(second).resolves.toBe(false);
  });

  it("two questions at once are asked one after the other, Cancel focused each time", async () => {
    render(ConfirmDialogHost);
    const first = confirmAction("Stop this port-forward?", "Stop port-forward");
    const second = confirmAction("Close this tab?", "Close tab");
    await tick();
    await tick();
    expect(screen.getByText("Stop port-forward")).toBeInTheDocument();
    expect(screen.queryByText("Close tab")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await expect(first).resolves.toBe(true);
    await tick();
    await tick();
    expect(screen.getByText("Close tab")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBe(false);
  });

  it("unmounting the host answers No to the open question", async () => {
    const view = render(ConfirmDialogHost);
    const { answer } = await openDialog();
    view.unmount();
    await expect(answer).resolves.toBe(false);
  });
});
