import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import WatcherToolbarControls from "./watcher-toolbar-controls.svelte";

describe("watcher toolbar controls", () => {
  it("renders shared watcher controls and dispatches callbacks", async () => {
    const onToggleWatcher = vi.fn();
    const onWatcherRefreshSecondsChange = vi.fn();
    const onResetWatcherSettings = vi.fn();
    const onRefresh = vi.fn();

    const { getByRole, getByDisplayValue } = render(WatcherToolbarControls, {
      props: {
        watcherEnabled: true,
        watcherRefreshSeconds: 30,
        showRefreshButton: true,
        onRefresh,
        onToggleWatcher,
        onWatcherRefreshSecondsChange,
        onResetWatcherSettings,
      },
    });

    await fireEvent.click(getByRole("button", { name: "Watcher: On" }));
    expect(onToggleWatcher).toHaveBeenCalledTimes(1);

    const refreshInput = getByDisplayValue("30") as HTMLInputElement;
    refreshInput.value = "45";
    await fireEvent.input(refreshInput);
    expect(onWatcherRefreshSecondsChange).toHaveBeenCalledWith(45);

    await fireEvent.click(getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await fireEvent.click(getByRole("button", { name: "Reset" }));
    expect(onResetWatcherSettings).toHaveBeenCalledTimes(1);
  });

  it("omits the refresh button by default", () => {
    const { queryByRole } = render(WatcherToolbarControls, {
      props: {
        watcherEnabled: false,
        watcherRefreshSeconds: 30,
        onToggleWatcher: vi.fn(),
        onWatcherRefreshSecondsChange: vi.fn(),
        onResetWatcherSettings: vi.fn(),
      },
    });

    expect(queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  });
});
