import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEventBus, type ClusterEvent } from "./event-bus";

describe("event-bus", () => {
  let bus: ReturnType<typeof createEventBus>;

  beforeEach(() => {
    bus = createEventBus();
  });

  it("calls subscribed listener on emit", () => {
    const listener = vi.fn();

    bus.subscribe(listener);

    const event: ClusterEvent = {
      clusterId: "c1",
      kind: "pod",
      payload: { foo: "bar" },
    };

    bus.emit(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("calls multiple listeners", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();

    bus.subscribe(l1);
    bus.subscribe(l2);

    bus.emit({
      clusterId: "c1",
      kind: "pod",
      payload: null,
    });

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("does not call unsubscribed listener", () => {
    const listener = vi.fn();

    const unsubscribe = bus.subscribe(listener);
    unsubscribe();

    bus.emit({
      clusterId: "c1",
      kind: "pod",
      payload: null,
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe does not affect other listeners", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();

    const unsubscribe = bus.subscribe(l1);
    bus.subscribe(l2);

    unsubscribe();

    bus.emit({
      clusterId: "c1",
      kind: "pod",
      payload: null,
    });

    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("clear removes all listeners", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();

    bus.subscribe(l1);
    bus.subscribe(l2);

    bus.clear();

    bus.emit({
      clusterId: "c1",
      kind: "pod",
      payload: null,
    });

    expect(l1).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
  });

  it("supports re-subscription after unsubscribe", () => {
    const listener = vi.fn();

    const unsubscribe = bus.subscribe(listener);
    unsubscribe();

    bus.subscribe(listener);

    bus.emit({
      clusterId: "c1",
      kind: "pod",
      payload: null,
    });

    expect(listener).toHaveBeenCalledOnce();
  });
});
