import { fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet, tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MultiPaneWorkbench from "./multi-pane-workbench.svelte";

const body = createRawSnippet(() => ({ render: () => "<div>panel body</div>" }));
const tabs = [{ id: "logs:web", title: "Logs", subtitle: "shop/web" }];

function props(overrides: Record<string, unknown> = {}) {
  return {
    tabs,
    activeTabId: "logs:web",
    isTabPinned: () => false,
    onActivateTab: vi.fn(),
    onTogglePin: vi.fn(),
    onCloseTab: vi.fn(),
    onReopenLastClosedTab: vi.fn(),
    layout: "single" as const,
    onLayoutChange: vi.fn(),
    fullscreen: false,
    onToggleFullscreen: vi.fn(),
    collapsed: false,
    onToggleCollapse: vi.fn(),
    body,
    ...overrides,
  };
}

async function settle() {
  await tick();
  await Promise.resolve();
  await tick();
}

// Logs on a row when the logs tab was already active did nothing: the reveal ran only
// when the active tab changed, and focus never moved to the panel.
describe("workbench reveal after a row action", () => {
  const scroll = vi.fn();
  let opener: HTMLButtonElement;

  beforeEach(() => {
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
    opener = document.createElement("button");
    opener.textContent = "Open actions for web";
    document.body.append(opener);
    opener.focus();
  });

  afterEach(() => {
    opener.remove();
  });

  it("reveals and focuses the panel on every request, also for the tab already open", async () => {
    const view = render(MultiPaneWorkbench, { props: props({ revealToken: 1 }) });
    await settle();
    const region = view.getByRole("region", { name: "Logs: shop/web" });
    expect(document.activeElement).toBe(region);
    const first = scroll.mock.calls.length;

    opener.focus();
    await view.rerender(props({ revealToken: 1 }));
    await settle();
    expect(scroll.mock.calls.length).toBe(first);

    await view.rerender(props({ revealToken: 2 }));
    await settle();
    expect(scroll.mock.calls.length).toBeGreaterThan(first);
    expect(document.activeElement).toBe(region);
  });

  it("leaves focus and scroll alone when the person types in a field outside the panel", async () => {
    const view = render(MultiPaneWorkbench, { props: props({ revealToken: null }) });
    await settle();
    const filter = document.createElement("input");
    filter.placeholder = "Filter pods...";
    document.body.append(filter);
    filter.focus();
    scroll.mockClear();

    // The cluster request finishes while the person is typing in the filter.
    await view.rerender(props({ revealToken: 1 }));
    await settle();

    expect(document.activeElement).toBe(filter);
    expect(scroll).not.toHaveBeenCalled();
    filter.remove();
  });

  it("closes the active tab on Esc and gives focus back to the row menu", async () => {
    const onCloseTab = vi.fn();
    const view = render(MultiPaneWorkbench, { props: props({ revealToken: 1, onCloseTab }) });
    await settle();
    const region = view.getByRole("region", { name: "Logs: shop/web" });

    await fireEvent.keyDown(region, { key: "Escape" });
    expect(onCloseTab).toHaveBeenCalledWith("logs:web");

    // The last tab closed: the panel goes away and focus returns to the row menu.
    view.unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("gives focus back when the panel goes away with focus inside", async () => {
    const view = render(MultiPaneWorkbench, { props: props({ revealToken: 1 }) });
    await settle();

    view.unmount();

    expect(document.activeElement).toBe(opener);
  });
});
