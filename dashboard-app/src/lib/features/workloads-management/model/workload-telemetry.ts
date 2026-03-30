import { telemetryEventBus } from "$shared/lib/telemetry-event-bus";

export function trackWorkloadEvent(name: string, payload?: Record<string, unknown>) {
  telemetryEventBus.emit({
    source: "workload",
    name,
    at: Date.now(),
    payload,
  });
}

type PerfBudgetAlert = {
  metric:
    | "overview.refresh.duration"
    | "workloads.refresh_duration"
    | "workloads.scheduler_wait_ms"
    | "workloads.view_render_ms"
    | "workloads.worker_queue_ms"
    | "workloads.worker_compute_ms"
    | "pods.refresh.duration"
    | "pods.metrics.resolve.duration"
    | "pods.table_render_ms";
  thresholdMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleSize: number;
};

type PerfBudgetOptions = {
  overviewRefreshP95Ms?: number;
  workloadsRefreshP95Ms?: number;
  workloadsSchedulerWaitP95Ms?: number;
  workloadsViewRenderP95Ms?: number;
  workloadsWorkerQueueP95Ms?: number;
  workloadsWorkerComputeP95Ms?: number;
  podsRefreshP95Ms?: number;
  podsMetricsResolveP95Ms?: number;
  podsTableRenderP95Ms?: number;
  minSamples?: number;
};

const DEFAULT_PERF_BUDGETS = {
  overviewRefreshP95Ms: 3_500,
  workloadsRefreshP95Ms: 2_500,
  workloadsSchedulerWaitP95Ms: 220,
  workloadsViewRenderP95Ms: 140,
  workloadsWorkerQueueP95Ms: 140,
  workloadsWorkerComputeP95Ms: 260,
  podsRefreshP95Ms: 2_000,
  podsMetricsResolveP95Ms: 2_400,
  podsTableRenderP95Ms: 120,
  minSamples: 10,
} as const;
const ALERT_COOLDOWN_MS = 60_000;
const lastAlertByMetric = new Map<string, number>();

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function collectDurations(metric: PerfBudgetAlert["metric"]): number[] {
  return telemetryEventBus
    .list()
    .filter((event) => event.source === "workload" && event.name === metric)
    .map((event) => event.payload?.durationMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function emitPerfBudgetAlert(alert: PerfBudgetAlert) {
  const now = Date.now();
  const lastAt = lastAlertByMetric.get(alert.metric) ?? 0;
  if (now - lastAt < ALERT_COOLDOWN_MS) return;
  lastAlertByMetric.set(alert.metric, now);
  telemetryEventBus.emit({
    source: "workload",
    name: "perf_budget_alert",
    at: now,
    payload: {
      metric: alert.metric,
      thresholdMs: alert.thresholdMs,
      p50Ms: alert.p50Ms,
      p95Ms: alert.p95Ms,
      p99Ms: alert.p99Ms,
      sampleSize: alert.sampleSize,
    },
  });
}

export function evaluateWorkloadPerfBudgets(options?: PerfBudgetOptions): PerfBudgetAlert[] {
  const overviewThreshold =
    options?.overviewRefreshP95Ms ?? DEFAULT_PERF_BUDGETS.overviewRefreshP95Ms;
  const workloadThreshold =
    options?.workloadsRefreshP95Ms ?? DEFAULT_PERF_BUDGETS.workloadsRefreshP95Ms;
  const schedulerWaitThreshold =
    options?.workloadsSchedulerWaitP95Ms ?? DEFAULT_PERF_BUDGETS.workloadsSchedulerWaitP95Ms;
  const viewRenderThreshold =
    options?.workloadsViewRenderP95Ms ?? DEFAULT_PERF_BUDGETS.workloadsViewRenderP95Ms;
  const workerQueueThreshold =
    options?.workloadsWorkerQueueP95Ms ?? DEFAULT_PERF_BUDGETS.workloadsWorkerQueueP95Ms;
  const workerComputeThreshold =
    options?.workloadsWorkerComputeP95Ms ?? DEFAULT_PERF_BUDGETS.workloadsWorkerComputeP95Ms;
  const podsThreshold = options?.podsRefreshP95Ms ?? DEFAULT_PERF_BUDGETS.podsRefreshP95Ms;
  const podsMetricsThreshold =
    options?.podsMetricsResolveP95Ms ?? DEFAULT_PERF_BUDGETS.podsMetricsResolveP95Ms;
  const podsTableRenderThreshold =
    options?.podsTableRenderP95Ms ?? DEFAULT_PERF_BUDGETS.podsTableRenderP95Ms;
  const minSamples = options?.minSamples ?? DEFAULT_PERF_BUDGETS.minSamples;
  const alerts: PerfBudgetAlert[] = [];

  const overviewDurations = collectDurations("overview.refresh.duration");
  if (overviewDurations.length >= minSamples) {
    const p50 = percentile(overviewDurations, 0.5);
    const p95 = percentile(overviewDurations, 0.95);
    const p99 = percentile(overviewDurations, 0.99);
    if (p95 > overviewThreshold) {
      alerts.push({
        metric: "overview.refresh.duration",
        thresholdMs: overviewThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: overviewDurations.length,
      });
    }
  }

  const workloadsDurations = collectDurations("workloads.refresh_duration");
  if (workloadsDurations.length >= minSamples) {
    const p50 = percentile(workloadsDurations, 0.5);
    const p95 = percentile(workloadsDurations, 0.95);
    const p99 = percentile(workloadsDurations, 0.99);
    if (p95 > workloadThreshold) {
      alerts.push({
        metric: "workloads.refresh_duration",
        thresholdMs: workloadThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: workloadsDurations.length,
      });
    }
  }

  const schedulerWaitDurations = collectDurations("workloads.scheduler_wait_ms");
  if (schedulerWaitDurations.length >= minSamples) {
    const p50 = percentile(schedulerWaitDurations, 0.5);
    const p95 = percentile(schedulerWaitDurations, 0.95);
    const p99 = percentile(schedulerWaitDurations, 0.99);
    if (p95 > schedulerWaitThreshold) {
      alerts.push({
        metric: "workloads.scheduler_wait_ms",
        thresholdMs: schedulerWaitThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: schedulerWaitDurations.length,
      });
    }
  }

  const viewRenderDurations = collectDurations("workloads.view_render_ms");
  if (viewRenderDurations.length >= minSamples) {
    const p50 = percentile(viewRenderDurations, 0.5);
    const p95 = percentile(viewRenderDurations, 0.95);
    const p99 = percentile(viewRenderDurations, 0.99);
    if (p95 > viewRenderThreshold) {
      alerts.push({
        metric: "workloads.view_render_ms",
        thresholdMs: viewRenderThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: viewRenderDurations.length,
      });
    }
  }

  const workerQueueDurations = collectDurations("workloads.worker_queue_ms");
  if (workerQueueDurations.length >= minSamples) {
    const p50 = percentile(workerQueueDurations, 0.5);
    const p95 = percentile(workerQueueDurations, 0.95);
    const p99 = percentile(workerQueueDurations, 0.99);
    if (p95 > workerQueueThreshold) {
      alerts.push({
        metric: "workloads.worker_queue_ms",
        thresholdMs: workerQueueThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: workerQueueDurations.length,
      });
    }
  }

  const workerComputeDurations = collectDurations("workloads.worker_compute_ms");
  if (workerComputeDurations.length >= minSamples) {
    const p50 = percentile(workerComputeDurations, 0.5);
    const p95 = percentile(workerComputeDurations, 0.95);
    const p99 = percentile(workerComputeDurations, 0.99);
    if (p95 > workerComputeThreshold) {
      alerts.push({
        metric: "workloads.worker_compute_ms",
        thresholdMs: workerComputeThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: workerComputeDurations.length,
      });
    }
  }

  const podsDurations = collectDurations("pods.refresh.duration");
  if (podsDurations.length >= minSamples) {
    const p50 = percentile(podsDurations, 0.5);
    const p95 = percentile(podsDurations, 0.95);
    const p99 = percentile(podsDurations, 0.99);
    if (p95 > podsThreshold) {
      alerts.push({
        metric: "pods.refresh.duration",
        thresholdMs: podsThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: podsDurations.length,
      });
    }
  }

  const podsMetricsDurations = collectDurations("pods.metrics.resolve.duration");
  if (podsMetricsDurations.length >= minSamples) {
    const p50 = percentile(podsMetricsDurations, 0.5);
    const p95 = percentile(podsMetricsDurations, 0.95);
    const p99 = percentile(podsMetricsDurations, 0.99);
    if (p95 > podsMetricsThreshold) {
      alerts.push({
        metric: "pods.metrics.resolve.duration",
        thresholdMs: podsMetricsThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: podsMetricsDurations.length,
      });
    }
  }

  const podsTableRenderDurations = collectDurations("pods.table_render_ms");
  if (podsTableRenderDurations.length >= minSamples) {
    const p50 = percentile(podsTableRenderDurations, 0.5);
    const p95 = percentile(podsTableRenderDurations, 0.95);
    const p99 = percentile(podsTableRenderDurations, 0.99);
    if (p95 > podsTableRenderThreshold) {
      alerts.push({
        metric: "pods.table_render_ms",
        thresholdMs: podsTableRenderThreshold,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        sampleSize: podsTableRenderDurations.length,
      });
    }
  }

  for (const alert of alerts) {
    emitPerfBudgetAlert(alert);
  }
  return alerts;
}

export function listWorkloadEvents() {
  return telemetryEventBus
    .list()
    .filter((event) => event.source === "workload")
    .map((event) => ({
      name: event.name,
      at: event.at,
      payload: event.payload,
    }));
}

export function clearWorkloadEvents() {
  telemetryEventBus.clearBySource("workload");
  lastAlertByMetric.clear();
}
