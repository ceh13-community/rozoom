import { afterEach, describe, expect, it, vi } from "vitest";
import { revealListFilteredTo } from "./jump-reveal";

describe("revealListFilteredTo", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function addFilter() {
    const input = document.createElement("input");
    input.placeholder = "Filter deployments...";
    // jsdom has no layout: offsetParent is null unless set.
    Object.defineProperty(input, "offsetParent", { get: () => document.body });
    input.scrollIntoView = vi.fn();
    document.body.appendChild(input);
    return input;
  }

  it("fills the list filter of the new page with the name and focuses it", async () => {
    vi.useFakeTimers();
    const typed = vi.fn();
    const found = revealListFilteredTo("web");
    // The page renders its list a moment after the navigation.
    await vi.advanceTimersByTimeAsync(300);
    const input = addFilter();
    input.addEventListener("input", typed);
    await vi.advanceTimersByTimeAsync(200);
    await expect(found).resolves.toBe(true);
    expect(input.value).toBe("web");
    expect(typed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
  });

  it("gives up when the page has no list filter", async () => {
    vi.useFakeTimers();
    const found = revealListFilteredTo("web");
    await vi.advanceTimersByTimeAsync(4100);
    await expect(found).resolves.toBe(false);
  });
});
