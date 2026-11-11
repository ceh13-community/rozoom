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
    await fireEvent.change(refreshInput);
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

  it("does not apply the value while it is being typed", async () => {
    // The parent clamps to at least 5 s. Applying "4" on the first keystroke turned the
    // field into "5", and the next digit made "55" instead of "45".
    const onWatcherRefreshSecondsChange = vi.fn();
    const { getByDisplayValue } = render(WatcherToolbarControls, {
      props: {
        watcherEnabled: true,
        watcherRefreshSeconds: 10,
        onToggleWatcher: vi.fn(),
        onWatcherRefreshSecondsChange,
        onResetWatcherSettings: vi.fn(),
      },
    });

    const refreshInput = getByDisplayValue("10") as HTMLInputElement;
    for (const typed of ["4", "45"]) {
      refreshInput.value = typed;
      await fireEvent.input(refreshInput);
    }
    expect(onWatcherRefreshSecondsChange).not.toHaveBeenCalled();
    expect(refreshInput.value).toBe("45");

    await fireEvent.change(refreshInput);
    expect(onWatcherRefreshSecondsChange).toHaveBeenCalledTimes(1);
    expect(onWatcherRefreshSecondsChange).toHaveBeenCalledWith(45);
  });

  it("shows the value that took effect after the change", async () => {
    // A value below the minimum is clamped by the parent; when the stored value does not
    // change, the field must not keep showing the rejected number.
    const onWatcherRefreshSecondsChange = vi.fn();
    const { getByDisplayValue } = render(WatcherToolbarControls, {
      props: {
        watcherEnabled: true,
        watcherRefreshSeconds: 5,
        onToggleWatcher: vi.fn(),
        onWatcherRefreshSecondsChange,
        onResetWatcherSettings: vi.fn(),
      },
    });

    const refreshInput = getByDisplayValue("5") as HTMLInputElement;
    refreshInput.value = "3";
    await fireEvent.change(refreshInput);
    expect(onWatcherRefreshSecondsChange).toHaveBeenCalledWith(3);
    expect(refreshInput.value).toBe("5");
  });
});
