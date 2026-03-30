import { describe, expect, it, vi } from "vitest";
import { createTelemetryEventBus } from "./telemetry-event-bus";

describe("telemetry-event-bus", () => {
  it("emits events to subscribers and stores history", () => {
    const bus = createTelemetryEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    bus.emit({ source: "port-forward", name: "start_attempt", at: 10, payload: { id: "a" } });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(bus.list()).toHaveLength(1);
    expect(bus.list()[0]?.source).toBe("port-forward");
  });

  it("keeps only the latest events by max size", () => {
    const bus = createTelemetryEventBus(2);
    bus.emit({ source: "a", name: "1", at: 1 });
    bus.emit({ source: "a", name: "2", at: 2 });
    bus.emit({ source: "a", name: "3", at: 3 });

    expect(bus.list().map((event) => event.name)).toEqual(["2", "3"]);
  });

  it("clears events for selected source only", () => {
    const bus = createTelemetryEventBus();
    bus.emit({ source: "port-forward", name: "a", at: 1 });
    bus.emit({ source: "workload", name: "b", at: 2 });

    bus.clearBySource("port-forward");

    expect(bus.list().map((event) => `${event.source}:${event.name}`)).toEqual(["workload:b"]);
  });

  it("drops stale events by max age", () => {
    const bus = createTelemetryEventBus(10, 100);
    bus.emit({ source: "workload", name: "old", at: 1_000 });
    bus.emit({ source: "workload", name: "fresh", at: 1_050 });
    bus.emit({ source: "workload", name: "new", at: 1_180 });

    expect(bus.list().map((event) => event.name)).toEqual(["new"]);
  });
});
