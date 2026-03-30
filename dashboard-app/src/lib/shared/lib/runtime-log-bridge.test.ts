import { beforeEach, describe, expect, it, vi } from "vitest";
import { telemetryEventBus } from "./telemetry-event-bus";
import { initRuntimeLogBridge, stopRuntimeLogBridge } from "./runtime-log-bridge";

describe("runtime-log-bridge", () => {
  beforeEach(() => {
    telemetryEventBus.clearEvents();
    stopRuntimeLogBridge();
    vi.restoreAllMocks();
  });

  it("mirrors watcher telemetry to runtime events and debug logs", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const runtimeEventSpy = vi.fn();
    window.addEventListener("runtime:telemetry", runtimeEventSpy);

    initRuntimeLogBridge();
    telemetryEventBus.emit({
      source: "watcher",
      name: "session_start",
      at: Date.now(),
      payload: { clusterId: "cluster-a", kind: "pod" },
    });

    expect(debugSpy).toHaveBeenCalledWith("[runtime:watcher]", "session_start", {
      clusterId: "cluster-a",
      kind: "pod",
    });
    expect(runtimeEventSpy).toHaveBeenCalledTimes(1);

    stopRuntimeLogBridge();
    window.removeEventListener("runtime:telemetry", runtimeEventSpy);
  });

  it("mirrors watcher logic errors to console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    initRuntimeLogBridge();
    telemetryEventBus.emit({
      source: "watcher",
      name: "logic_error",
      at: Date.now(),
      payload: { clusterId: "cluster-a", error: "Invariant violated" },
    });

    expect(errorSpy).toHaveBeenCalledWith("[runtime:watcher]", "logic_error", {
      clusterId: "cluster-a",
      error: "Invariant violated",
    });

    stopRuntimeLogBridge();
  });
});
