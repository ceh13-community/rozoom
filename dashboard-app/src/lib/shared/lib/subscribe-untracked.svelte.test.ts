import { flushSync } from "svelte";
import { writable, type Readable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { subscribeUntracked } from "./subscribe-untracked";

type Item = { name: string; hint?: string };
type Subscribe = (store: Readable<Item[]>, handler: (items: Item[]) => void) => () => void;

// The shape of a list page backed by a sync store: an effect seeds the store from the page
// data, and the store subscriber rebuilds the snapshot from the previous one (the CronJobs
// list does this to keep the next-run hints a watch event leaves out).
function mountList(subscribe: Subscribe) {
  const store = writable<Item[]>([]);
  let data = $state<Item[]>([{ name: "nightly-backup", hint: "02:00" }]);
  let snapshot = $state<Item[]>([]);

  const stop = $effect.root(() => {
    const unsubscribe = subscribe(store, (items) => {
      const previous = new Map(snapshot.map((item) => [item.name, item]));
      snapshot = items.map((item) => ({
        ...item,
        hint: item.hint ?? previous.get(item.name)?.hint,
      }));
    });
    $effect(() => {
      store.set(data);
    });
    return unsubscribe;
  });

  return {
    flush: () => flushSync(),
    setData(next: Item[]) {
      data = next;
      flushSync();
    },
    get snapshot() {
      return snapshot;
    },
    stop,
  };
}

const subscribeTracked: Subscribe = (store, handler) => store.subscribe(handler);

describe("subscribeUntracked", () => {
  // A store calls its subscribers inside whatever effect updated it. A plain subscriber that
  // reads and writes the snapshot makes that effect rerun on its own write: the CronJobs page
  // went blank with effect_update_depth_exceeded this way.
  it("control: a plain subscriber called from an effect loops", () => {
    // Svelte's dev build also prints where the state was updated; keep that out of the output.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const list = mountList(subscribeTracked);
    try {
      expect(() => list.flush()).toThrow(/effect_update_depth_exceeded/);
    } finally {
      list.stop();
      consoleError.mockRestore();
    }
  });

  it("runs the subscriber outside the effect that updated the store", () => {
    const list = mountList(subscribeUntracked);
    try {
      expect(() => list.flush()).not.toThrow();
      expect(list.snapshot).toEqual([{ name: "nightly-backup", hint: "02:00" }]);

      list.setData([{ name: "nightly-backup" }, { name: "hourly-report" }]);

      expect(list.snapshot).toEqual([
        { name: "nightly-backup", hint: "02:00" },
        { name: "hourly-report", hint: undefined },
      ]);
    } finally {
      list.stop();
    }
  });

  it("stops calling the handler after unsubscribe", () => {
    const store = writable(1);
    const seen: number[] = [];
    const unsubscribe = subscribeUntracked(store, (value) => seen.push(value));
    store.set(2);
    unsubscribe();
    store.set(3);
    expect(seen).toEqual([1, 2]);
  });
});
