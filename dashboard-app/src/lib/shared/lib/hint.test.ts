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

  it("describes the control for screen readers, also through a wrapper", () => {
    const wrapper = document.createElement("span");
    const button = document.createElement("button");
    button.textContent = "Minimize";
    wrapper.appendChild(button);
    document.body.appendChild(wrapper);
    const action = hint(wrapper, { text: "Minimize the window", placement: "bottom" });
    expect(button).toHaveAccessibleDescription("Minimize the window");
    action.update({ text: "Expand the window", placement: "bottom" });
    expect(button).toHaveAccessibleDescription("Expand the window");
    action.destroy();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("shows on keyboard focus of a wrapped button and hides when focus leaves", () => {
    const wrapper = document.createElement("span");
    const button = document.createElement("button");
    wrapper.appendChild(button);
    document.body.appendChild(wrapper);
    hint(wrapper, "Close");
    button.focus();
    vi.advanceTimersByTime(500);
    expect(bubble()?.textContent).toBe("Close");
    button.blur();
    expect(bubble()).toBeNull();
  });

  it("adds no description that repeats the control's name", () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Settings");
    document.body.appendChild(button);
    const action = hint(button, "Settings");
    expect(button).not.toHaveAttribute("aria-describedby");
    action.update("Settings of this cluster");
    expect(button).toHaveAccessibleDescription("Settings of this cluster");
  });
});
