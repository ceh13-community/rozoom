import { writable, type Writable } from "svelte/store";

export interface WatchEvent<T> {
  type: "ADDED" | "MODIFIED" | "DELETED";
  object: T;
}

export interface ResourceAdapter<T> {
  getId(item: T): string;
  filter?(event: WatchEvent<T>): boolean;

  // Optional merge strategy for partial objects on ADDED/MODIFIED
  merge?(prev: T, next: T, event: WatchEvent<T>): T;
}

// A watch burst (initial fill, relist, a rollout) delivers hundreds of events in a row.
// Every store notification re-runs the whole list chain of the open page (rows, filter,
// sort, render), so one notification per event froze the pods page for the length of
// the burst. Events still land in the list at once; subscribers hear about the first
// event right away and about the rest of the burst once per window.
export const RESOURCE_STORE_BATCH_MS = 80;

export function createResourceStore<T>(adapter: ResourceAdapter<T>) {
  const store: Writable<Record<string, T[]>> = writable({});
  let state: Record<string, T[]> = {};
  store.subscribe((value) => {
    state = value;
  });

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  // Give subscribers a new state object; the lists inside are the mutated ones.
  function notify() {
    dirty = false;
    store.set({ ...state });
  }

  function scheduleNotify() {
    if (flushTimer) {
      dirty = true;
      return;
    }
    notify();
    const tick = () => {
      if (!dirty) {
        flushTimer = null;
        return;
      }
      notify();
      flushTimer = setTimeout(tick, RESOURCE_STORE_BATCH_MS);
    };
    flushTimer = setTimeout(tick, RESOURCE_STORE_BATCH_MS);
  }

  function cancelPending() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    dirty = false;
  }

  function apply(clusterId: string, event: WatchEvent<T>) {
    if (adapter.filter && !adapter.filter(event)) return;

    const list = state[clusterId] ?? (state[clusterId] = []);
    const id = adapter.getId(event.object);

    switch (event.type) {
      case "ADDED":
      case "MODIFIED": {
        const idx = list.findIndex((i) => adapter.getId(i) === id);
        const nextObject =
          idx >= 0 && adapter.merge ? adapter.merge(list[idx], event.object, event) : event.object;

        // Mutate the array in place (no copy of thousands of items); the notification
        // below hands subscribers a new state object so the change is detected.
        if (idx >= 0) {
          list[idx] = nextObject;
        } else {
          list.push(nextObject);
        }
        break;
      }

      case "DELETED": {
        const delIdx = list.findIndex((i) => adapter.getId(i) === id);
        if (delIdx >= 0) {
          list.splice(delIdx, 1);
        }
        break;
      }
    }

    scheduleNotify();
  }

  function setInitial(clusterId: string, items: T[]) {
    cancelPending();
    store.update((s) => ({ ...s, [clusterId]: items }));
  }

  function clear(clusterId: string) {
    cancelPending();
    store.update((s) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- hot path, avoid copying
      delete s[clusterId];
      return s;
    });
  }

  return { store, apply, setInitial, clear };
}
