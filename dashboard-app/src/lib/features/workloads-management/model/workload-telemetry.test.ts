import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkloadEvents,
  evaluateWorkloadPerfBudgets,
  listWorkloadEvents,
  trackWorkloadEvent,
} from "./workload-telemetry";
import { telemetryEventBus } from "$shared/lib/telemetry-event-bus";

describe("workload-telemetry", () => {
  beforeEach(() => {
    clearWorkloadEvents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks and lists events", () => {
    telemetryEventBus.clearEvents();
    trackWorkloadEvent("details_open", { workload: "pods" });
    expect(listWorkloadEvents()).toHaveLength(1);
    expect(listWorkloadEvents()[0]?.name).toBe("details_open");
    const last = telemetryEventBus.list().at(-1);
    expect(last?.source).toBe("workload");
  });

  it("emits perf budget alerts when p95 exceeds threshold", () => {
    telemetryEventBus.clearEvents();
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("overview.refresh.duration", { durationMs: i < 11 ? 500 : 5_200 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("pods.refresh.duration", { durationMs: i < 11 ? 400 : 4_100 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("pods.metrics.resolve.duration", { durationMs: i < 11 ? 300 : 3_200 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("pods.table_render_ms", { durationMs: i < 11 ? 12 : 260 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("workloads.scheduler_wait_ms", { durationMs: i < 11 ? 10 : 400 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("workloads.view_render_ms", { durationMs: i < 11 ? 25 : 310 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("workloads.worker_queue_ms", { durationMs: i < 11 ? 15 : 280 });
    }
    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("workloads.worker_compute_ms", { durationMs: i < 11 ? 40 : 360 });
    }

    const alerts = evaluateWorkloadPerfBudgets({
      overviewRefreshP95Ms: 2_000,
      workloadsSchedulerWaitP95Ms: 120,
      workloadsViewRenderP95Ms: 120,
      workloadsWorkerQueueP95Ms: 120,
      workloadsWorkerComputeP95Ms: 180,
      podsRefreshP95Ms: 1_500,
      podsMetricsResolveP95Ms: 1_400,
      podsTableRenderP95Ms: 100,
      minSamples: 10,
    });
    expect(alerts).toHaveLength(8);
    expect(alerts.map((alert) => alert.metric).sort()).toEqual([
      "overview.refresh.duration",
      "pods.metrics.resolve.duration",
      "pods.refresh.duration",
      "pods.table_render_ms",
      "workloads.scheduler_wait_ms",
      "workloads.view_render_ms",
      "workloads.worker_compute_ms",
      "workloads.worker_queue_ms",
    ]);

    const emitted = telemetryEventBus
      .list()
      .filter((event) => event.source === "workload" && event.name === "perf_budget_alert");
    expect(emitted.length).toBe(8);
  });

  it("does not emit perf budget alerts when metrics stay within budget", () => {
    telemetryEventBus.clearEvents();
    for (let i = 0; i < 20; i += 1) {
      trackWorkloadEvent("workloads.refresh_duration", { durationMs: 500 });
      trackWorkloadEvent("workloads.view_render_ms", { durationMs: 40 });
      trackWorkloadEvent("workloads.scheduler_wait_ms", { durationMs: 20 });
      trackWorkloadEvent("workloads.worker_queue_ms", { durationMs: 15 });
      trackWorkloadEvent("workloads.worker_compute_ms", { durationMs: 35 });
    }
    const alerts = evaluateWorkloadPerfBudgets({ minSamples: 10 });
    expect(alerts).toHaveLength(0);
    const emitted = telemetryEventBus
      .list()
      .filter((event) => event.source === "workload" && event.name === "perf_budget_alert");
    expect(emitted).toHaveLength(0);
  });

  it("throttles repeated perf budget alerts for the same hot metric within cooldown", () => {
    telemetryEventBus.clearEvents();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08T10:00:00Z"));

    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("workloads.scheduler_wait_ms", { durationMs: i < 11 ? 20 : 480 });
    }
    const firstAlerts = evaluateWorkloadPerfBudgets({
      workloadsSchedulerWaitP95Ms: 120,
      minSamples: 10,
    });
    expect(firstAlerts.map((alert) => alert.metric)).toEqual(["workloads.scheduler_wait_ms"]);

    for (let i = 0; i < 12; i += 1) {
      trackWorkloadEvent("workloads.scheduler_wait_ms", { durationMs: i < 11 ? 30 : 500 });
    }
    evaluateWorkloadPerfBudgets({
      workloadsSchedulerWaitP95Ms: 120,
      minSamples: 10,
    });

    let emitted = telemetryEventBus
      .list()
      .filter((event) => event.source === "workload" && event.name === "perf_budget_alert");
    expect(emitted).toHaveLength(1);

    vi.advanceTimersByTime(60_001);
    evaluateWorkloadPerfBudgets({
      workloadsSchedulerWaitP95Ms: 120,
      minSamples: 10,
    });

    emitted = telemetryEventBus
      .list()
      .filter((event) => event.source === "workload" && event.name === "perf_budget_alert");
    expect(emitted).toHaveLength(2);
  });
});
