import { beforeEach, describe, expect, it, vi } from "vitest";

const captureExceptionMock = vi.fn();

vi.mock("@sentry/sveltekit", () => ({
  captureException: captureExceptionMock,
}));

describe("watcher-telemetry", () => {
  beforeEach(async () => {
    vi.resetModules();
    captureExceptionMock.mockReset();
    const { resetWatcherTelemetry } = await import("./watcher-telemetry");
    resetWatcherTelemetry();
  });

  it("tracks watcher counters and events", async () => {
    const {
      getWatcherTelemetrySummary,
      getWatcherHealthSnapshot,
      listWatcherTelemetryClusterRows,
      listWatcherTelemetryEvents,
      trackWatcherFallback,
      trackWatcherPathSkipped,
      trackWatcherRelist,
      trackWatcherRetry,
      trackWatcherSessionStart,
      trackWatcherSessionStop,
      trackWatcherTransportError,
    } = await import("./watcher-telemetry");

    trackWatcherSessionStart({ clusterId: "cluster-a", kind: "pod" });
    trackWatcherRelist({ clusterId: "cluster-a", kind: "pod" });
    trackWatcherRetry({ clusterId: "cluster-a", kind: "pod", retryCount: 1, backoffMs: 1_250 });
    trackWatcherFallback({ clusterId: "cluster-a", kind: "pod" });
    trackWatcherPathSkipped({ clusterId: "cluster-a", kind: "pod", path: "/apis/example/v1" });
    trackWatcherTransportError({ clusterId: "cluster-a", kind: "pod", stage: "watch" });
    trackWatcherSessionStop({ clusterId: "cluster-a", kind: "pod" });

    expect(getWatcherHealthSnapshot()).toEqual({
      activeSessions: 0,
      activeApiSessions: 0,
      fallbackSessions: 1,
      retryScheduledCount: 1,
      relistCount: 1,
      transportErrorCount: 1,
      pathSkippedCount: 1,
      logicErrorCount: 0,
      lastEventAt: expect.any(Number),
    });
    expect(listWatcherTelemetryEvents().map((event) => event.name)).toEqual([
      "session_start",
      "watch_relist",
      "retry_scheduled",
      "fallback_enabled",
      "path_skipped",
      "transport_error",
      "session_stop",
    ]);
    expect(getWatcherTelemetrySummary()).toEqual({
      activeSessions: 0,
      activeApiSessions: 0,
      fallbackSessions: 1,
      retryScheduledCount: 1,
      relistCount: 1,
      transportErrorCount: 1,
      pathSkippedCount: 1,
      logicErrorCount: 0,
      lastEventAt: expect.any(Number),
      sampleSize: 7,
    });
    expect(listWatcherTelemetryClusterRows()).toEqual([
      {
        clusterId: "cluster-a",
        activeSessions: 0,
        fallbackCount: 1,
        retryCount: 1,
        relistCount: 1,
        transportErrorCount: 1,
        logicErrorCount: 0,
        lastEventAt: expect.any(Number),
        lastTransport: null,
        lastKind: "pod",
      },
    ]);
  });

  it("sends only logic errors to sentry", async () => {
    const { trackWatcherLogicError, trackWatcherTransportError } = await import(
      "./watcher-telemetry"
    );

    trackWatcherTransportError({
      clusterId: "cluster-a",
      kind: "configuration",
      error: "ServiceUnavailable",
    });
    trackWatcherLogicError({
      clusterId: "cluster-a",
      kind: "configuration",
      error: "Invariant violated",
    });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          source: "watcher",
          event: "logic_error",
        }),
      }),
    );
  });
});
