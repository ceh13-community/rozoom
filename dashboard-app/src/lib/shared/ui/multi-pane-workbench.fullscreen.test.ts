import { render } from "@testing-library/svelte";
import { createRawSnippet, tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import MultiPaneWorkbench from "./multi-pane-workbench.svelte";

// A port-forward tab opened in fullscreen and then collapsed left a blank page: the
// fullscreen panel covered the whole window and the collapsed workbench showed nothing
// but its tab strip. Fullscreen now expands the workbench and offers no Collapse.
const body = createRawSnippet(() => ({
  render: () => '<div data-testid="pane-body">Web shop/web</div>',
}));
const tabs = [{ id: "pf:web", title: "web", subtitle: "shop" }];

function props(overrides: Record<string, unknown> = {}) {
  return {
    tabs,
    activeTabId: "pf:web",
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

describe("workbench fullscreen and collapse", () => {
  it("offers Collapse outside fullscreen and leaves a collapsed workbench alone", async () => {
    const onToggleCollapse = vi.fn();
    const view = render(MultiPaneWorkbench, {
      props: props({ collapsed: true, onToggleCollapse }),
    });
    await settle();

    expect(view.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it("hides Collapse while fullscreen is on and leaves an expanded workbench alone", async () => {
    const onToggleCollapse = vi.fn();
    const view = render(MultiPaneWorkbench, {
      props: props({ fullscreen: true, onToggleCollapse }),
    });
    await settle();

    expect(view.getByRole("button", { name: "Exit Fullscreen" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Collapse" })).toBeNull();
    expect(view.queryByRole("button", { name: "Expand" })).toBeNull();
    expect(view.getByTestId("pane-body")).toBeInTheDocument();
    // "if (fullscreen) onToggleCollapse()" would collapse an expanded workbench: the same blank page.
    expect(onToggleCollapse).not.toHaveBeenCalled();
  });

  it("expands a collapsed workbench when fullscreen turns on, also for a restored state", async () => {
    const onToggleCollapse = vi.fn();
    const view = render(MultiPaneWorkbench, {
      props: props({ fullscreen: true, collapsed: true, onToggleCollapse }),
    });
    await settle();

    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("button", { name: "Expand" })).toBeNull();
  });
});
