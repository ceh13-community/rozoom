import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hint } from "./hint";

const bubble = () => document.querySelector("[data-testid=hint]");

describe("hint", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function mount(text = "Pods") {
    const node = document.createElement("a");
    document.body.appendChild(node);
    return { node, action: hint(node, text) };
  }

  it("shows after a short hover and hides when the pointer leaves", () => {
    const { node } = mount();
    node.dispatchEvent(new Event("pointerenter"));
    expect(bubble()).toBeNull();
    vi.advanceTimersByTime(500);
    expect(bubble()?.textContent).toBe("Pods");
    expect(bubble()?.getAttribute("role")).toBe("tooltip");
    node.dispatchEvent(new Event("pointerleave"));
    expect(bubble()).toBeNull();
  });

  it("hides on click while the cursor stays still", () => {
    const { node } = mount();
    node.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(500);
    node.dispatchEvent(new Event("pointerdown"));
    expect(bubble()).toBeNull();
  });

  it("does not show when the click comes before the delay", () => {
    const { node } = mount();
    node.dispatchEvent(new Event("pointerenter"));
    node.dispatchEvent(new Event("pointerdown"));
    vi.advanceTimersByTime(1000);
    expect(bubble()).toBeNull();
  });

  it("goes away with the element", () => {
    const { node, action } = mount();
    node.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(500);
    action.destroy();
    expect(bubble()).toBeNull();
  });
});
