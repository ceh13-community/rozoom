import { fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleGlobalKeydown,
  hasOpenOverlay,
  pushOverlay,
  resetKeyboardManager,
} from "$shared/lib/keyboard-manager";
import DetailsSheetPortal from "./details-sheet-portal.svelte";

const children = createRawSnippet(() => ({
  render: () =>
    `<div><button type="button" data-testid="inside">Inside</button><input type="text" data-testid="search" /><input type="checkbox" data-testid="checkbox" /><textarea data-testid="editor"></textarea></div>`,
}));

function renderPortal(open = true) {
  const onClose = vi.fn();
  const view = render(DetailsSheetPortal, { props: { open, onClose, children } });
  return { onClose, view };
}

function byTestId<T extends HTMLElement>(id: string): T {
  return document.querySelector<T>(`[data-testid='${id}']`)!;
}

// The cluster page wires the keyboard manager to window keydown.
const windowHandler = (event: Event) => handleGlobalKeydown(event as KeyboardEvent);

describe("details-sheet-portal", () => {
  beforeEach(() => {
    resetKeyboardManager();
    window.addEventListener("keydown", windowHandler);
  });

  afterEach(() => {
    window.removeEventListener("keydown", windowHandler);
    resetKeyboardManager();
    document.body.innerHTML = "";
  });

  it("joins the overlay stack only while open", async () => {
    const { view } = renderPortal(false);
    expect(hasOpenOverlay()).toBe(false);
    await view.rerender({ open: true });
    expect(hasOpenOverlay()).toBe(true);
    await view.rerender({ open: false });
    expect(hasOpenOverlay()).toBe(false);
  });

  it("closes on Escape", async () => {
    const { onClose } = renderPortal();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed on a button inside the panel", async () => {
    const { onClose } = renderPortal();
    await fireEvent.keyDown(byTestId("inside"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed on a checkbox inside the panel", async () => {
    const { onClose } = renderPortal();
    await fireEvent.keyDown(byTestId("checkbox"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a text field on the first Escape and closes on the second", async () => {
    const { onClose } = renderPortal();
    const search = byTestId<HTMLInputElement>("search");
    search.focus();
    await fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    const panel = document.querySelector("aside")!;
    expect(document.activeElement).toBe(panel);

    await fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the panel open on Escape from an editor inside it", async () => {
    const { onClose } = renderPortal();
    await fireEvent.keyDown(byTestId("editor"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape while closed", async () => {
    const { onClose } = renderPortal(false);
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves Escape to an overlay opened on top of the panel", async () => {
    const { onClose } = renderPortal();
    const closePalette = vi.fn();
    pushOverlay("command-palette", closePalette);
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(closePalette).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape already handled by a menu or dialog", async () => {
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
