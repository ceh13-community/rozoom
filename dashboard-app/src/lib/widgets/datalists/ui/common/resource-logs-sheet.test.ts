import { fireEvent, render, screen } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import ResourceLogsSheet from "./resource-logs-sheet.svelte";

function renderSheet(overrides: Record<string, unknown> = {}) {
  const onTogglePrevious = vi.fn();
  render(ResourceLogsSheet, {
    props: {
      embedded: true,
      isOpen: writable(true),
      podRef: "shop/web-1",
      logs: "",
      loading: false,
      error: null,
      isLive: true,
      mode: "stream-f",
      lastUpdatedAt: null,
      previous: false,
      selectedContainer: "web",
      containerOptions: ["web"],
      bookmarks: [],
      onToggleLive: vi.fn(),
      onSetMode: vi.fn(),
      onTogglePrevious,
      onSelectContainer: vi.fn(),
      onRefresh: vi.fn(),
      onAddBookmark: vi.fn(),
      onRemoveBookmark: vi.fn(),
      jumpToLine: null,
      onJumpHandled: vi.fn(),
      ...overrides,
    },
  });
  return { onTogglePrevious, button: () => screen.getByTestId("logs-previous-toggle") };
}

describe("ResourceLogsSheet Previous toggle", () => {
  it("is enabled by default", async () => {
    const { onTogglePrevious, button } = renderSheet();
    expect(button()).not.toBeDisabled();
    await fireEvent.click(button());
    expect(onTogglePrevious).toHaveBeenCalledOnce();
  });

  it("is disabled with the reason when there is no previous container", () => {
    const hint = "No previous logs: container web has not restarted.";
    const { button } = renderSheet({ previousAvailable: false, previousHint: hint });
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent("Previous: Off");
    expect(button()).toHaveAccessibleDescription(hint);
    expect(button().parentElement).toHaveAttribute("title", hint);
  });

  it("stays enabled while on, so it can be turned off", () => {
    const { button } = renderSheet({ previous: true, previousAvailable: false, previousHint: "x" });
    expect(button()).not.toBeDisabled();
    expect(button()).toHaveTextContent("Previous: On");
  });
});
