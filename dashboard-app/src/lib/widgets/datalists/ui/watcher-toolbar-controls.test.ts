import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import WatcherToolbarControls from "./watcher-toolbar-controls.svelte";
import {
  LIST_FRESHNESS_CONTEXT,
  type ListFreshnessSource,
} from "./common/list-freshness-context.svelte";

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

  describe("in a list that shows its freshness", () => {
    function renderIn(source: Partial<ListFreshnessSource> & { watcherEnabled: boolean }) {
      return render(WatcherToolbarControls, {
        props: {
          watcherEnabled: source.watcherEnabled,
          watcherRefreshSeconds: 30,
          onToggleWatcher: vi.fn(),
          onWatcherRefreshSecondsChange: vi.fn(),
          onResetWatcherSettings: vi.fn(),
        },
        context: new Map([
          [
            LIST_FRESHNESS_CONTEXT,
            { state: "live", mode: "stream", updatedAt: null, streamLive: true, ...source },
          ],
        ]),
      });
    }

    it("hides Watcher and Sync sec while the watch is connected", () => {
      const { queryByRole, queryByText } = renderIn({ streamLive: true, watcherEnabled: true });
      expect(queryByRole("button", { name: "Watcher: On" })).not.toBeInTheDocument();
      expect(queryByText("Sync sec")).not.toBeInTheDocument();
      expect(queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
    });

    it("keeps them while the watch is paused, so it can be resumed", () => {
      const { getByRole } = renderIn({ streamLive: true, watcherEnabled: false });
      expect(getByRole("button", { name: "Watcher: Off" })).toBeInTheDocument();
    });

    it("keeps them while the watch is down and the list polls", () => {
      const { getByRole, getByText } = renderIn({ streamLive: false, watcherEnabled: true });
      expect(getByRole("button", { name: "Watcher: On" })).toBeInTheDocument();
      expect(getByText("Sync sec")).toBeInTheDocument();
    });

    it("keeps them in poll mode", () => {
      const { getByRole, getByText } = renderIn({
        mode: "poll",
        streamLive: false,
        watcherEnabled: true,
      });
      expect(getByRole("button", { name: "Watcher: On" })).toBeInTheDocument();
      expect(getByText("Sync sec")).toBeInTheDocument();
    });

    it("keeps Sync sec in Pods, where it times CPU and Memory on a live watch", () => {
      const { getByRole, getByText } = renderIn({
        mode: "stream",
        streamLive: true,
        watcherEnabled: true,
        syncSecondsAlwaysApplies: true,
      });
      expect(getByText("Sync sec")).toBeInTheDocument();
      expect(getByRole("button", { name: "Watcher: On" })).toBeInTheDocument();
      expect(getByRole("button", { name: "Reset" })).toBeInTheDocument();
    });
  });
});
