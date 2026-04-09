import { describe, expect, it, vi } from "vitest";
import { createTableKeyboardNav } from "./table-keyboard-navigation";

function key(keyName: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: keyName, bubbles: true });
}

describe("createTableKeyboardNav", () => {
  it("starts with no highlighted row", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 10,
      onActivate: vi.fn(),
    });
    expect(nav.highlightedIndex).toBe(-1);
  });

  it("moves down on j", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate: vi.fn(),
    });
    nav.handleKeydown(key("j"));
    expect(nav.highlightedIndex).toBe(0);
    nav.handleKeydown(key("j"));
    expect(nav.highlightedIndex).toBe(1);
  });

  it("moves up on k", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate: vi.fn(),
    });
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("k"));
    expect(nav.highlightedIndex).toBe(0);
  });

  it("does not go below zero on k", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate: vi.fn(),
    });
    nav.handleKeydown(key("k"));
    expect(nav.highlightedIndex).toBe(0);
  });

  it("does not exceed row count on j", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 2,
      onActivate: vi.fn(),
    });
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("j"));
    expect(nav.highlightedIndex).toBe(1);
  });

  it("calls onActivate on Enter", () => {
    const onActivate = vi.fn();
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate,
    });
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("Enter"));
    expect(onActivate).toHaveBeenCalledWith(1);
  });

  it("does not call onActivate when no row is highlighted", () => {
    const onActivate = vi.fn();
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate,
    });
    nav.handleKeydown(key("Enter"));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("respects isEnabled guard", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate: vi.fn(),
      isEnabled: () => false,
    });
    nav.handleKeydown(key("j"));
    expect(nav.highlightedIndex).toBe(-1);
  });

  it("ignores j/k when Ctrl is held", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate: vi.fn(),
    });
    nav.handleKeydown(new KeyboardEvent("keydown", { key: "j", ctrlKey: true }));
    expect(nav.highlightedIndex).toBe(-1);
  });

  it("resets highlighted index", () => {
    const nav = createTableKeyboardNav({
      getRowCount: () => 5,
      onActivate: vi.fn(),
    });
    nav.handleKeydown(key("j"));
    nav.handleKeydown(key("j"));
    nav.reset();
    expect(nav.highlightedIndex).toBe(-1);
  });
});
