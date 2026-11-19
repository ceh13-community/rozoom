import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampScrollTop, keepScrollInRange } from "./scroll-position";

// jsdom has no layout: give the element the sizes the field log reported and a scrollTop
// that keeps whatever is written to it, like WebKitGTK with GPU compositing did.
function scrollContainer({ scrollTop = 0, scrollHeight = 771, clientHeight = 770 } = {}) {
  const element = document.createElement("div");
  let top = scrollTop;
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  Object.defineProperty(element, "scrollHeight", { get: () => scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { get: () => clientHeight });
  return element;
}

describe("clampScrollTop", () => {
  it("brings a scroll position past the end back to the last screen", () => {
    // Global Triage in the field: scroll=2171/771 in a 770 px pane, nothing in view.
    const pane = scrollContainer({ scrollTop: 2171, scrollHeight: 771 });
    clampScrollTop(pane);
    expect(pane.scrollTop).toBe(1);
  });

  it("leaves a position inside the content alone", () => {
    const pane = scrollContainer({ scrollTop: 400, scrollHeight: 3052 });
    clampScrollTop(pane);
    expect(pane.scrollTop).toBe(400);
  });
});

describe("keepScrollInRange", () => {
  const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];

  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        disconnect() {
          this.targets.length = 0;
        }
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fireResize() {
    for (const { callback } of observers) callback([], {} as ResizeObserver);
  }

  it("clamps the scroll position when the content shrinks", () => {
    // The cluster menu after Collapse: shorter content, the old position stays past the end.
    let contentHeight = 1400;
    const menu = scrollContainer({ scrollTop: 700, scrollHeight: 0, clientHeight: 600 });
    Object.defineProperty(menu, "scrollHeight", { get: () => contentHeight });
    menu.appendChild(document.createElement("div"));
    const action = keepScrollInRange(menu);

    contentHeight = 620;
    fireResize();

    expect(menu.scrollTop).toBe(20);
    action.destroy();
  });

  it("watches the content that replaces the old page", async () => {
    const pane = scrollContainer();
    const first = document.createElement("section");
    pane.appendChild(first);
    const action = keepScrollInRange(pane);
    expect(observers[0].targets).toEqual([pane, first]);

    const next = document.createElement("section");
    pane.replaceChild(next, first);
    await Promise.resolve();

    expect(observers[0].targets).toEqual([pane, next]);
    action.destroy();
    expect(observers[0].targets).toEqual([]);
  });
});
