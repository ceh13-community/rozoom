import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { createResourceStore, RESOURCE_STORE_BATCH_MS } from "./resource-store";

type Item = { id: string; phase?: string };

const cluster = "c1";

function setup() {
  const resource = createResourceStore<Item>({ getId: (item) => item.id });
  let notifications = 0;
  const stop = resource.store.subscribe(() => {
    notifications += 1;
  });
  notifications = 0;
  return { ...resource, stop, count: () => notifications };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createResourceStore batching", () => {
  it("lands every event in the list at once and notifies subscribers once per window", () => {
    const { store, apply, count, stop } = setup();

    for (let index = 0; index < 500; index += 1) {
      apply(cluster, { type: "ADDED", object: { id: `pod-${index}` } });
    }

    // The data is there synchronously (readers that call get() see the burst).
    expect(get(store)[cluster]).toHaveLength(500);
    // Subscribers heard about the first event, not about each of the 500.
    expect(count()).toBe(1);

    vi.advanceTimersByTime(RESOURCE_STORE_BATCH_MS);
    expect(count()).toBe(2);

    // Nothing new: the window closes without another notification.
    vi.advanceTimersByTime(RESOURCE_STORE_BATCH_MS);
    expect(count()).toBe(2);
    stop();
  });

  it("keeps one notification per window while a burst continues", () => {
    const { apply, count, stop } = setup();

    apply(cluster, { type: "ADDED", object: { id: "pod-0" } });
    expect(count()).toBe(1);
    for (let window = 1; window <= 5; window += 1) {
      for (let index = 0; index < 50; index += 1) {
        apply(cluster, { type: "MODIFIED", object: { id: "pod-0", phase: `w${window}-${index}` } });
      }
      vi.advanceTimersByTime(RESOURCE_STORE_BATCH_MS);
      expect(count()).toBe(1 + window);
    }
    stop();
  });

  it("notifies a lone event right away", () => {
    const { store, apply, count, stop } = setup();

    apply(cluster, { type: "ADDED", object: { id: "pod-0", phase: "Pending" } });

    expect(count()).toBe(1);
    expect(get(store)[cluster][0].phase).toBe("Pending");
    stop();
  });

  it("applies a delete that follows an add inside the same window", () => {
    const { store, apply, count, stop } = setup();

    apply(cluster, { type: "ADDED", object: { id: "pod-0" } });
    apply(cluster, { type: "ADDED", object: { id: "pod-1" } });
    apply(cluster, { type: "DELETED", object: { id: "pod-0" } });

    expect(get(store)[cluster].map((item) => item.id)).toEqual(["pod-1"]);
    vi.advanceTimersByTime(RESOURCE_STORE_BATCH_MS);
    expect(count()).toBe(2);
    expect(get(store)[cluster].map((item) => item.id)).toEqual(["pod-1"]);
    stop();
  });

  it("replaces the list on setInitial and drops the pending window", () => {
    const { store, apply, setInitial, count, stop } = setup();

    apply(cluster, { type: "ADDED", object: { id: "pod-0" } });
    apply(cluster, { type: "ADDED", object: { id: "pod-1" } });
    setInitial(cluster, [{ id: "fresh" }]);

    expect(get(store)[cluster].map((item) => item.id)).toEqual(["fresh"]);
    const afterInitial = count();
    vi.advanceTimersByTime(RESOURCE_STORE_BATCH_MS * 2);
    expect(count()).toBe(afterInitial);
    stop();
  });

  it("merges partial objects through the adapter", () => {
    const resource = createResourceStore<Item>({
      getId: (item) => item.id,
      merge: (prev, next) => ({ ...prev, ...next }),
    });

    resource.apply(cluster, { type: "ADDED", object: { id: "pod-0", phase: "Pending" } });
    resource.apply(cluster, { type: "MODIFIED", object: { id: "pod-0" } });

    expect(get(resource.store)[cluster][0].phase).toBe("Pending");
  });
});
