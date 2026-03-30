import { describe, expect, it } from "vitest";
import { telemetryEventBus } from "$shared/lib/telemetry-event-bus";
import {
  buildAdaptiveConnectivityState,
  buildClusterRequestInspector,
  buildClusterTrustBannerModel,
} from "./cluster-page-runtime";

describe("cluster-page-runtime", () => {
  it("builds a cluster-scoped request inspector from workload, watcher and port-forward telemetry", () => {
    telemetryEventBus.clearEvents();
    telemetryEventBus.emit({
      source: "workload",
      name: "workloads.cache_hit",
      at: 1,
      payload: { clusterUuid: "cluster-a", workloadType: "pods", namespace: "all" },
    });
    telemetryEventBus.emit({
      source: "watcher",
      name: "fallback_enabled",
      at: 2,
      payload: { clusterId: "cluster-a", kind: "pods" },
    });
    telemetryEventBus.emit({
      source: "port-forward",
      name: "start_result",
      at: 3,
      payload: {
        clusterId: "cluster-a",
        namespace: "apps",
        resource: "svc/demo",
        success: false,
        reason: "timeout",
      },
    });
    telemetryEventBus.emit({
      source: "workload",
      name: "workloads.cache_hit",
      at: 4,
      payload: { clusterUuid: "cluster-b", workloadType: "pods", namespace: "all" },
    });

    const inspector = buildClusterRequestInspector("cluster-a");

    expect(inspector.summary.sampleSize).toBe(3);
    expect(inspector.summary.cacheEvents).toBe(1);
    expect(inspector.summary.degradedEvents).toBe(2);
    expect(inspector.rows.map((row) => row.source)).toEqual([
      "port-forward",
      "watcher",
      "workload",
    ]);
    expect(inspector.rows[0]?.title).toContain("port-forward failed");
    expect(inspector.rows[1]?.title).toContain("watcher fallback");
    expect(inspector.rows[2]?.title).toContain("cache hit");
  });

  it("derives adaptive connectivity degradation from recent degraded telemetry", () => {
    telemetryEventBus.clearEvents();
    const now = Date.now();
    telemetryEventBus.emit({
      source: "watcher",
      name: "transport_error",
      at: now - 1_000,
      payload: { clusterId: "cluster-a", kind: "pods", error: "connection reset" },
    });
    telemetryEventBus.emit({
      source: "watcher",
      name: "fallback_enabled",
      at: now - 800,
      payload: { clusterId: "cluster-a", kind: "pods" },
    });

    expect(buildAdaptiveConnectivityState("cluster-a")).toEqual({
      active: true,
      reason:
        "Recent watcher transport or logic errors moved this cluster into adaptive degraded mode.",
      recommendedSensitivity: "unstable",
    });
  });

  it("ignores optional capability errors for cluster-wide adaptive degradation", () => {
    telemetryEventBus.clearEvents();
    const now = Date.now();
    telemetryEventBus.emit({
      source: "watcher",
      name: "logic_error",
      at: now - 1_000,
      payload: {
        clusterId: "cluster-a",
        kind: "configuration",
        error: 'error: the server doesn\'t have a resource type "gatewayclasses"',
      },
    });
    telemetryEventBus.emit({
      source: "watcher",
      name: "logic_error",
      at: now - 800,
      payload: {
        clusterId: "cluster-a",
        kind: "configuration",
        error: 'error: the server doesn\'t have a resource type "referencegrants"',
      },
    });

    expect(buildAdaptiveConnectivityState("cluster-a")).toEqual({
      active: false,
      reason:
        "Optional capability gaps or metrics endpoint issues were observed, but they do not require cluster-wide adaptive degraded mode.",
      recommendedSensitivity: "normal",
    });
  });

  it("recovers adaptive degraded mode after the quiet window elapses", () => {
    telemetryEventBus.clearEvents();
    const now = Date.now();
    telemetryEventBus.emit({
      source: "watcher",
      name: "transport_error",
      at: now - 6 * 60 * 1000,
      payload: { clusterId: "cluster-a", kind: "pods", error: "connection reset" },
    });
    telemetryEventBus.emit({
      source: "watcher",
      name: "fallback_enabled",
      at: now - 6 * 60 * 1000 + 200,
      payload: { clusterId: "cluster-a", kind: "pods" },
    });

    expect(buildAdaptiveConnectivityState("cluster-a")).toEqual({
      active: false,
      reason:
        "Adaptive degraded mode recovered after a quiet period without watcher transport or logic failures.",
      recommendedSensitivity: "normal",
    });
  });

  it("does not escalate metrics endpoint issues into cluster-wide degraded mode", () => {
    telemetryEventBus.clearEvents();
    const now = Date.now();
    telemetryEventBus.emit({
      source: "watcher",
      name: "transport_error",
      at: now - 1_000,
      payload: {
        clusterId: "cluster-a",
        kind: "nodes",
        error:
          'Error from server (ServiceUnavailable): no endpoints available for service "http:kube-prometheus-stack-kubelet:10250"',
      },
    });
    telemetryEventBus.emit({
      source: "watcher",
      name: "logic_error",
      at: now - 800,
      payload: {
        clusterId: "cluster-a",
        kind: "nodes",
        error: "Metrics API not available",
      },
    });

    expect(buildAdaptiveConnectivityState("cluster-a")).toEqual({
      active: false,
      reason:
        "Optional capability gaps or metrics endpoint issues were observed, but they do not require cluster-wide adaptive degraded mode.",
      recommendedSensitivity: "normal",
    });
  });

  it("builds a recovery banner that explains section health may already be normal", () => {
    expect(
      buildClusterTrustBannerModel({
        adaptiveConnectivityState: {
          active: true,
          reason:
            "Recent watcher transport or logic errors moved this cluster into adaptive degraded mode.",
          recommendedSensitivity: "unstable",
        },
        clusterRuntimeState: "degraded",
        clusterRuntimeProfileSummary: "Balanced profile",
        workloadCacheBanner: null,
      }),
    ).toEqual({
      tone: "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100",
      title: "Cluster runtime is recovering",
      detail:
        "Recent watcher transport or logic errors moved this cluster into adaptive degraded mode. The current section may already be rendering normally, but cluster-wide runtime remains in a 5-minute recovery window after recent watcher failures. Active profile: Balanced profile. Runtime budget is currently biased toward unstable connectivity.",
    });
  });
});
