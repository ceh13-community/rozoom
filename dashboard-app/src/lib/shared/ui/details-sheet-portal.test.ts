import { fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet, tick } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import DetailsSheetPortal from "./details-sheet-portal.svelte";

const children = createRawSnippet(() => ({
  render: () =>
    `<div><button type="button" data-testid="inside">Inside</button><input role="combobox" data-testid="inside-combobox" /></div>`,
}));

function renderPortal(open = true) {
  const onClose = vi.fn();
  const view = render(DetailsSheetPortal, { props: { open, onClose, children } });
  return { onClose, view };
}

describe("details-sheet-portal", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("closes on Escape", async () => {
    const { onClose } = renderPortal();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed inside the panel", async () => {
    const { onClose } = renderPortal();
    const inside = document.querySelector<HTMLButtonElement>("[data-testid='inside']")!;
    await fireEvent.keyDown(inside, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape from a combobox inside the panel", async () => {
    const { onClose } = renderPortal();
    const combobox = document.querySelector<HTMLInputElement>("[data-testid='inside-combobox']")!;
    await fireEvent.keyDown(combobox, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while closed", async () => {
    const { onClose } = renderPortal(false);
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape to a dialog or menu opened on top of the panel", async () => {
    const { onClose } = renderPortal();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "alertdialog");
    const confirm = document.createElement("button");
    dialog.appendChild(confirm);
    document.body.appendChild(dialog);
    await fireEvent.keyDown(confirm, { key: "Escape" });

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    await fireEvent.keyDown(menu, { key: "Escape" });

    const palette = document.createElement("input");
    palette.setAttribute("role", "combobox");
    document.body.appendChild(palette);
    await fireEvent.keyDown(palette, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape already handled by someone else", async () => {
    const { onClose } = renderPortal();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the panel when it opens", async () => {
    renderPortal();
    await tick();
    const panel = document.querySelector("aside")!;
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});
