import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreFocus, revealBlock, revealResult } from "./reveal-result";

describe("revealResult", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows the top of a panel taller than the screen and moves least otherwise", () => {
    expect(revealBlock(1200, 800)).toBe("start");
    expect(revealBlock(300, 800)).toBe("nearest");
    expect(revealBlock(300, 0)).toBe("nearest");
  });

  it("scrolls the panel into view and focuses it", () => {
    const panel = document.createElement("div");
    panel.tabIndex = -1;
    document.body.append(panel);
    const scroll = vi.fn();
    panel.scrollIntoView = scroll;

    revealResult(panel);

    expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
    expect(document.activeElement).toBe(panel);
  });

  it("does not animate the scroll when reduced motion is asked for", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    const panel = document.createElement("div");
    document.body.append(panel);
    const scroll = vi.fn();
    panel.scrollIntoView = scroll;

    revealResult(panel, { focus: false });

    expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "nearest" });
  });

  it("gives focus back only to an element that is still on the page", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(restoreFocus(button)).toBe(true);
    expect(document.activeElement).toBe(button);

    button.remove();
    expect(restoreFocus(button)).toBe(false);
    expect(restoreFocus(null)).toBe(false);
  });
});
