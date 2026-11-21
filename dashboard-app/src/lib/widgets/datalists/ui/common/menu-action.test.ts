import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMenuAction } from "./menu-action";

describe("createMenuAction", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function setup(blocked = false) {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const close = vi.fn();
    const menuAction = createMenuAction({
      close,
      getTrigger: () => trigger,
      isBlocked: () => blocked,
    });
    return { trigger, close, menuAction };
  }

  it("runs the action after the menu closed and keeps the menu's focus return away", () => {
    const { trigger, close, menuAction } = setup();
    const action = vi.fn(() => {
      // By now the trigger has focus without the page scrolling to it.
      expect(document.activeElement).toBe(trigger);
    });
    menuAction.select(action);
    expect(close).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();

    const closeEvent = new Event("close", { cancelable: true });
    menuAction.onCloseAutoFocus(closeEvent);
    expect(closeEvent.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(0);
    expect(action).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(500);
    expect(action).toHaveBeenCalledOnce();
  });

  it("runs the action when no close event comes", () => {
    const { menuAction } = setup();
    const action = vi.fn();
    menuAction.select(action);
    vi.advanceTimersByTime(300);
    expect(action).toHaveBeenCalledOnce();
  });

  it("lets a plain close return focus as usual", () => {
    const { menuAction } = setup();
    menuAction.select(vi.fn());
    vi.advanceTimersByTime(300);
    menuAction.reset();
    const closeEvent = new Event("close", { cancelable: true });
    menuAction.onCloseAutoFocus(closeEvent);
    expect(closeEvent.defaultPrevented).toBe(false);
  });

  it("does nothing while the row is busy", () => {
    const { close, menuAction } = setup(true);
    const action = vi.fn();
    menuAction.select(action);
    vi.advanceTimersByTime(500);
    expect(close).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });
});
