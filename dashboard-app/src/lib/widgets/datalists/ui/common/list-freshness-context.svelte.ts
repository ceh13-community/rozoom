import { getContext, onMount, setContext } from "svelte";
import { writable } from "svelte/store";
import { selectResourceStreamLive } from "$features/check-health";
import type { ListSourceState, ListSyncMode } from "./list-freshness";

/** What a list knows about its own freshness; getters, so readers stay reactive. */
export type ListFreshnessSource = {
  readonly state: ListSourceState;
  readonly mode: ListSyncMode;
  readonly updatedAt: number | null;
  readonly streamLive?: boolean | null;
  readonly watcherEnabled: boolean;
  /** Sync sec also times data the watch does not carry (Pods: CPU and Memory). */
  readonly syncSecondsAlwaysApplies?: boolean;
};

export const LIST_FRESHNESS_CONTEXT = Symbol("list-freshness");

/**
 * Number of mounted lists that show their own freshness indicator. The page header
 * hides its indicator while one is on screen: one indicator per page.
 */
export const listFreshnessOwners = writable(0);

/**
 * Called by a list during init. The summary strip shows the indicator from this
 * source, and the watcher controls in the list toolbar read the sync mode from it.
 */
export function provideListFreshness(source: ListFreshnessSource) {
  setContext(LIST_FRESHNESS_CONTEXT, source);
  onMount(() => {
    listFreshnessOwners.update((count) => count + 1);
    return () => {
      listFreshnessOwners.update((count) => count - 1);
    };
  });
}

export function readListFreshness(): ListFreshnessSource | null {
  return getContext<ListFreshnessSource | undefined>(LIST_FRESHNESS_CONTEXT) ?? null;
}

/** Whether the watch of `kind` on the cluster is connected, as reactive state. */
export function watchStreamLive(kind: string, getClusterId: () => string | null | undefined) {
  let live = $state(false);
  $effect(() => {
    const clusterId = getClusterId();
    if (!clusterId) return;
    const unsubscribe = selectResourceStreamLive(kind, clusterId).subscribe((value) => {
      live = value;
    });
    return () => {
      unsubscribe();
      live = false;
    };
  });
  return {
    get current() {
      return live;
    },
  };
}
