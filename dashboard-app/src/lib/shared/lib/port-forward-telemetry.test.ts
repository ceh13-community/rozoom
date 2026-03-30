import { describe, expect, it } from "vitest";
import {
  getPortForwardTelemetrySnapshot,
  listPortForwardTelemetryEvents,
  resetPortForwardTelemetry,
  trackPortForwardStartAttempt,
  trackPortForwardStartResult,
  trackPortForwardStopAttempt,
  trackPortForwardStopResult,
} from "./port-forward-telemetry";
import { telemetryEventBus } from "./telemetry-event-bus";

describe("port-forward-telemetry", () => {
  it("tracks start/stop counters", () => {
    resetPortForwardTelemetry();
    telemetryEventBus.clearBySource("port-forward");

    trackPortForwardStartAttempt({ uniqueKey: "a", clusterId: "cluster-a", namespace: "apps" });
    trackPortForwardStartResult({ uniqueKey: "a", success: true, clusterId: "cluster-a" });
    trackPortForwardStartAttempt({ uniqueKey: "b", clusterId: "cluster-a", namespace: "apps" });
    trackPortForwardStartResult({
      uniqueKey: "b",
      success: false,
      reason: "timeout",
      clusterId: "cluster-a",
    });
    trackPortForwardStopAttempt({ uniqueKey: "a", clusterId: "cluster-a" });
    trackPortForwardStopResult({ uniqueKey: "a", success: true, clusterId: "cluster-a" });

    expect(getPortForwardTelemetrySnapshot()).toEqual({
      startAttempts: 2,
      startSuccesses: 1,
      startFailures: 1,
      stopAttempts: 1,
      stopSuccesses: 1,
      stopFailures: 0,
      timeoutFailures: 1,
    });
    const events = listPortForwardTelemetryEvents().map((event) => event.name);
    expect(events).toEqual([
      "start_attempt",
      "start_result",
      "start_attempt",
      "start_result",
      "stop_attempt",
      "stop_result",
    ]);

    resetPortForwardTelemetry();
    expect(
      telemetryEventBus.list().filter((event) => event.source === "port-forward"),
    ).toHaveLength(0);
  });
});
