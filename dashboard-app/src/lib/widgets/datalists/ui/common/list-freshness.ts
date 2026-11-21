// One freshness indicator per list page. Before, a list showed up to four that disagreed:
// the page header ("3m ago": time of the last full list), "Sync: updated", a "Live" badge
// on its own row and "Watcher: Active". With a live watch nothing is re-listed, so the
// header time grew while every change was already on screen.

export type ListSourceState = "live" | "cached" | "stale" | "paused" | "error" | "idle";
export type ListSyncMode = "stream" | "poll" | "manual" | "on-demand";

export type ListFreshnessInput = {
  state: ListSourceState;
  mode: ListSyncMode;
  /** Last time the list got data: a list, a poll or a watch event. */
  updatedAt: number | null;
  /** Whether the watch is connected; null when the list cannot tell. */
  streamLive?: boolean | null;
};

export type ListFreshnessTone = "live" | "ok" | "warn" | "error" | "muted";

export type ListFreshnessView = {
  label: string;
  tone: ListFreshnessTone;
  /** Longer explanation for the hover text. */
  title: string;
};

function ago(formatAge: (ms: number) => string, updatedAt: number, now: number) {
  const age = formatAge(Math.max(0, now - updatedAt));
  return age === "0s" ? "just now" : `${age} ago`;
}

export function describeListFreshness(
  input: ListFreshnessInput,
  now: number,
  formatAge: (ms: number) => string,
): ListFreshnessView {
  const { state, mode, updatedAt } = input;
  const since = updatedAt ? ago(formatAge, updatedAt, now) : null;

  if (state === "error") {
    return {
      label: "Error",
      tone: "error",
      title: "The last refresh failed. The table shows the last data that loaded.",
    };
  }
  if (state === "paused") {
    return {
      label: since ? `Paused, updated ${since}` : "Paused",
      tone: "muted",
      title: "Background updates are off. Turn the watcher on to resume them.",
    };
  }
  if (state === "idle") {
    return { label: "Loading", tone: "muted", title: "Waiting for the first data." };
  }

  if (mode === "stream") {
    // A watch sends only changes: a quiet list is current, not stale.
    if (input.streamLive === false) {
      return {
        label: since ? `Reconnecting, updated ${since}` : "Reconnecting",
        tone: "warn",
        title: "The watch is not connected. The table shows the last data that arrived.",
      };
    }
    return {
      label: "Live",
      tone: "live",
      title: since
        ? `Changes appear as they happen. Last change ${since}.`
        : "Changes appear as they happen.",
    };
  }

  if (state === "stale") {
    return {
      label: since ? `Stale, updated ${since}` : "Stale",
      tone: "warn",
      title: "The data is older than the refresh interval allows.",
    };
  }
  return {
    label: since ? `Updated ${since}` : "Updated",
    tone: "ok",
    title:
      mode === "poll"
        ? "Refreshed on the interval set in Sync sec."
        : "Refreshed when the page opens or on Refresh.",
  };
}

/**
 * Watcher toggle and Sync sec only matter when the list polls. They stay when the
 * watcher is off, so a paused list can be resumed.
 */
export function showsWatcherControls(mode: ListSyncMode, watcherEnabled: boolean) {
  return mode !== "stream" || !watcherEnabled;
}
