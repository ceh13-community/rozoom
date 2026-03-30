import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("$shared/api/apiserver-metrics", () => ({
  fetchApiserverMetrics: vi.fn(),
}));

import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import { checkApfHealth } from "./check-apf-health";

const mockedFetch = vi.mocked(fetchApiserverMetrics);

function makeMetricsOutput(metrics: Record<string, number>): string {
  return Object.entries(metrics)
    .map(([key, value]) => `${key} ${value}`)
    .join("\n");
}

describe("checkApfHealth", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when APF metrics are healthy", async () => {
    mockedFetch.mockResolvedValue({
      output: makeMetricsOutput({
        apiserver_flowcontrol_current_inqueue_requests: 5,
        apiserver_flowcontrol_nominal_limit_seats: 100,
        apiserver_flowcontrol_request_concurrency_limit: 200,
        apiserver_flowcontrol_rejected_requests_total: 0,
        apiserver_flowcontrol_request_wait_duration_seconds_sum: 0,
        apiserver_flowcontrol_request_wait_duration_seconds_count: 0,
      }),
      // @ts-expect-error undefined on purpose
      error: undefined,
    });

    const result = await checkApfHealth(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.metrics).toBeDefined();
    expect(result.metrics?.inQueueRequests).toBe(5);
    expect(result.metrics?.nominalLimitSeats).toBe(100);
  });

  it("returns unknown when no APF metrics found", async () => {
    mockedFetch.mockResolvedValue({
      output: "",
      // @ts-expect-error undefined on purpose
      error: undefined,
    });

    const result = await checkApfHealth(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.metrics).toBeNull();
  });

  it("returns unknown on fetch error", async () => {
    mockedFetch.mockResolvedValue({
      output: "",
      error: "connection refused",
    });

    const result = await checkApfHealth(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedFetch.mockRejectedValue(new Error("network failure"));

    const result = await checkApfHealth(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("detects high queue utilization as warning", async () => {
    mockedFetch.mockResolvedValue({
      output: makeMetricsOutput({
        apiserver_flowcontrol_current_inqueue_requests: 85,
        apiserver_flowcontrol_nominal_limit_seats: 100,
        apiserver_flowcontrol_rejected_requests_total: 0,
        apiserver_flowcontrol_request_wait_duration_seconds_sum: 0,
        apiserver_flowcontrol_request_wait_duration_seconds_count: 0,
      }),
      // @ts-expect-error undefined on purpose
      error: undefined,
    });

    const result = await checkApfHealth(clusterId, { force: true });

    // Queue utilization 85/100 = 0.85 > 0.8 warning threshold
    expect(["warning", "critical"]).toContain(result.status);
  });

  it("detects critical queue utilization", async () => {
    mockedFetch.mockResolvedValue({
      output: makeMetricsOutput({
        apiserver_flowcontrol_current_inqueue_requests: 95,
        apiserver_flowcontrol_nominal_limit_seats: 100,
        apiserver_flowcontrol_rejected_requests_total: 0,
        apiserver_flowcontrol_request_wait_duration_seconds_sum: 0,
        apiserver_flowcontrol_request_wait_duration_seconds_count: 0,
      }),
      // @ts-expect-error undefined on purpose
      error: undefined,
    });

    const result = await checkApfHealth(clusterId, { force: true });

    // Queue utilization 95/100 = 0.95 > 0.9 critical threshold
    expect(result.status).toBe("critical");
  });

  it("handles metrics with label selectors in output", async () => {
    const output = [
      "# HELP apiserver_flowcontrol_current_inqueue_requests Number of requests currently pending",
      "# TYPE apiserver_flowcontrol_current_inqueue_requests gauge",
      'apiserver_flowcontrol_current_inqueue_requests{flow_schema="global-default",priority_level="global-default"} 2',
      'apiserver_flowcontrol_current_inqueue_requests{flow_schema="exempt",priority_level="exempt"} 3',
      'apiserver_flowcontrol_nominal_limit_seats{priority_level="global-default"} 50',
      'apiserver_flowcontrol_nominal_limit_seats{priority_level="exempt"} 50',
    ].join("\n");

    mockedFetch.mockResolvedValue({
      output,
      // @ts-expect-error undefined on purpose
      error: undefined,
    });

    const result = await checkApfHealth(clusterId, { force: true });

    expect(result.metrics).toBeDefined();
    expect(result.metrics?.inQueueRequests).toBe(5);
    expect(result.metrics?.nominalLimitSeats).toBe(100);
  });

  it("includes summary with updatedAt timestamp", async () => {
    mockedFetch.mockResolvedValue({
      output: makeMetricsOutput({
        apiserver_flowcontrol_current_inqueue_requests: 0,
        apiserver_flowcontrol_nominal_limit_seats: 100,
      }),
      // @ts-expect-error undefined on purpose
      error: undefined,
    });

    const result = await checkApfHealth(clusterId, { force: true });

    expect(result.summary).toBeDefined();
    expect(result.summary.updatedAt).toBeGreaterThan(0);
    expect(result.updatedAt).toBeGreaterThan(0);
  });
});
