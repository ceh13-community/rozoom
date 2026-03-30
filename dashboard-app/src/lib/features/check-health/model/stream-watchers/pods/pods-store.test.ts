import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";

import { podsStore, setInitialPods } from "./pods-store";
import { eventBus } from "../event-bus";
import type { PodWatchEvent } from "./pods-parser";

const clusterId = "cluster-1";

function emitPodEvent(event: PodWatchEvent) {
  eventBus.emit({
    clusterId,
    kind: "pod",
    payload: event,
  });
}

beforeEach(() => {
  // eventBus.clear();
  setInitialPods(clusterId, []);
});

describe("podsStore", () => {
  it("sgould set initial pods", () => {
    setInitialPods(clusterId, [
      { metadata: { name: "pod-1", namespace: "default" } },
      { metadata: { name: "pod-2", namespace: "default" } },
    ]);

    const state = get(podsStore);

    expect(state[clusterId]).toHaveLength(2);
  });

  it("should add pod on ADDED event", () => {
    emitPodEvent({
      type: "ADDED",
      object: { metadata: { name: "nginx", namespace: "default" } },
    });

    const pods = get(podsStore)[clusterId];

    expect(pods).toHaveLength(1);
    expect(pods[0].metadata?.name).toBe("nginx");
  });

  it("should update pod on MODIFIED event", () => {
    emitPodEvent({
      type: "ADDED",
      object: {
        metadata: { name: "nginx", namespace: "default" },
        status: { phase: "Pending", containerStatuses: [] },
      },
    });

    emitPodEvent({
      type: "MODIFIED",
      object: {
        metadata: { name: "nginx", namespace: "default" },
        status: { phase: "Running", containerStatuses: [] },
      },
    });

    const pod = get(podsStore)[clusterId][0];

    expect(pod.status?.phase).toBe("Running");
  });

  it("should remove pod on DELETED event", () => {
    emitPodEvent({
      type: "ADDED",
      object: { metadata: { name: "nginx", namespace: "default" } },
    });

    emitPodEvent({
      type: "DELETED",
      object: { metadata: { name: "nginx", namespace: "default" } },
    });

    const pods = get(podsStore)[clusterId];

    expect(pods).toHaveLength(0);
  });

  it("should ignore duplicate ADDED events", () => {
    emitPodEvent({
      type: "ADDED",
      object: { metadata: { name: "nginx", namespace: "default" } },
    });

    emitPodEvent({
      type: "ADDED",
      object: { metadata: { name: "nginx", namespace: "default" } },
    });

    const pods = get(podsStore)[clusterId];

    expect(pods).toHaveLength(1);
  });

  it("should ignore non-pod events", () => {
    eventBus.emit({
      clusterId,
      kind: "node",
      payload: { anything: true },
    });

    const pods = get(podsStore)[clusterId];

    expect(pods).toHaveLength(0);
  });

  it("should support multiple clusters independently", () => {
    emitPodEvent({
      type: "ADDED",
      object: { metadata: { name: "pod-a", namespace: "default" } },
    });

    eventBus.emit({
      clusterId: "cluster-2",
      kind: "pod",
      payload: {
        type: "ADDED",
        object: { metadata: { name: "pod-b" } },
      },
    });

    const state = get(podsStore);

    expect(state["cluster-1"]).toHaveLength(1);
    expect(state["cluster-2"]).toHaveLength(1);
  });
});
