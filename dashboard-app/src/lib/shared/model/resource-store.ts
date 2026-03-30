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

export function createResourceStore<T>(adapter: ResourceAdapter<T>) {
  const store: Writable<Record<string, T[]>> = writable({});

  function apply(clusterId: string, event: WatchEvent<T>) {
    if (adapter.filter && !adapter.filter(event)) return;

    store.update((state) => {
      const list = state[clusterId] ?? [];
      const id = adapter.getId(event.object);

      switch (event.type) {
        case "ADDED":
        case "MODIFIED": {
          const idx = list.findIndex((i) => adapter.getId(i) === id);
          const nextObject =
            idx >= 0 && adapter.merge
              ? adapter.merge(list[idx], event.object, event)
              : event.object;

          // Mutate the array in-place (avoid copying thousands of items),
          // but create a new state object ref so Svelte detects the change.
          if (idx >= 0) {
            list[idx] = nextObject;
          } else {
            list.push(nextObject);
          }

          return { ...state, [clusterId]: list };
        }

        case "DELETED": {
          const delIdx = list.findIndex((i) => adapter.getId(i) === id);
          if (delIdx >= 0) {
            list.splice(delIdx, 1);
          }
          return { ...state, [clusterId]: list };
        }
      }
    });
  }

  function setInitial(clusterId: string, items: T[]) {
    store.update((s) => ({ ...s, [clusterId]: items }));
  }

  function clear(clusterId: string) {
    store.update((s) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- hot path, avoid copying
      delete s[clusterId];
      return s;
    });
  }

  return { store, apply, setInitial, clear };
}
