import { describe, expect, it } from "vitest";
import { formatAgeMs } from "$shared/lib/timeFormatters";
import {
  describeListFreshness,
  showsWatcherControls,
  type ListFreshnessInput,
} from "./list-freshness";

const NOW = 1_800_000_000_000;
const view = (input: ListFreshnessInput) => describeListFreshness(input, NOW, formatAgeMs);

describe("describeListFreshness", () => {
  it("says Live on a connected watch however long the list has been quiet", () => {
    const quiet = { mode: "stream" as const, updatedAt: NOW - 3 * 60_000, streamLive: true };
    expect(view({ ...quiet, state: "live" })).toMatchObject({ label: "Live", tone: "live" });
    // Workload lists mark a quiet watch as stale after two Sync sec: not on a watch.
    expect(view({ ...quiet, state: "stale" })).toMatchObject({ label: "Live", tone: "live" });
    expect(view({ ...quiet, state: "live" }).title).toBe(
      "Changes appear as they happen. Last change 3m ago.",
    );
  });

  it("says Reconnecting when the watch is down", () => {
    expect(
      view({ state: "live", mode: "stream", updatedAt: NOW - 42_000, streamLive: false }),
    ).toMatchObject({ label: "Reconnecting, updated 42s ago", tone: "warn" });
  });

  it("counts the time of the last poll in poll mode", () => {
    expect(view({ state: "live", mode: "poll", updatedAt: NOW - 12_000 })).toMatchObject({
      label: "Updated 12s ago",
      tone: "ok",
    });
    expect(view({ state: "cached", mode: "poll", updatedAt: NOW })).toMatchObject({
      label: "Updated just now",
    });
    expect(view({ state: "stale", mode: "poll", updatedAt: NOW - 5 * 60_000 })).toMatchObject({
      label: "Stale, updated 5m ago",
      tone: "warn",
    });
  });

  it("shows errors, pauses and the first load", () => {
    expect(view({ state: "error", mode: "stream", updatedAt: NOW })).toMatchObject({
      label: "Error",
      tone: "error",
    });
    expect(view({ state: "paused", mode: "poll", updatedAt: NOW - 60_000 })).toMatchObject({
      label: "Paused, updated 1m ago",
      tone: "muted",
    });
    expect(view({ state: "idle", mode: "poll", updatedAt: null }).label).toBe("Loading");
  });
});

describe("showsWatcherControls", () => {
  it("hides the watcher toggle and Sync sec while a watch is connected", () => {
    expect(showsWatcherControls({ streamLive: true, watcherEnabled: true })).toBe(false);
  });

  it("keeps them while the list polls, also when a watch dropped", () => {
    expect(showsWatcherControls({ streamLive: false, watcherEnabled: true })).toBe(true);
    expect(showsWatcherControls({ streamLive: null, watcherEnabled: true })).toBe(true);
    expect(showsWatcherControls({ watcherEnabled: true })).toBe(true);
  });

  it("keeps them to resume a pause", () => {
    expect(showsWatcherControls({ streamLive: true, watcherEnabled: false })).toBe(true);
  });

  it("keeps them where Sync sec times more than the poll", () => {
    expect(
      showsWatcherControls({
        streamLive: true,
        watcherEnabled: true,
        syncSecondsAlwaysApplies: true,
      }),
    ).toBe(true);
  });
});
