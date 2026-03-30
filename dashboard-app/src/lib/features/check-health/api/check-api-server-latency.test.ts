import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import { checkApiServerLatency } from "./check-api-server-latency";

vi.mock("$shared/api/apiserver-metrics");
vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

const mockedFetchApiserverMetrics = vi.mocked(fetchApiserverMetrics);

describe("checkApiServerLatency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores WATCH and health endpoint buckets when computing latency status", async () => {
    mockedFetchApiserverMetrics.mockResolvedValue({
      output: [
        'apiserver_request_duration_seconds_bucket{verb="WATCH",resource="pods",le="60"} 10',
        'apiserver_request_duration_seconds_bucket{verb="WATCH",resource="pods",le="+Inf"} 10',
        'apiserver_request_duration_seconds_bucket{verb="GET",subresource="/readyz",le="60"} 10',
        'apiserver_request_duration_seconds_bucket{verb="GET",subresource="/readyz",le="+Inf"} 10',
        'apiserver_request_duration_seconds_bucket{verb="GET",resource="pods",le="0.1"} 9',
        'apiserver_request_duration_seconds_bucket{verb="GET",resource="pods",le="1"} 10',
        'apiserver_request_duration_seconds_bucket{verb="GET",resource="pods",le="+Inf"} 10',
      ].join("\n"),
      error: null,
    });

    const result = await checkApiServerLatency("cluster-a", { force: true });

    expect(mockedFetchApiserverMetrics).toHaveBeenCalledWith("cluster-a", {
      force: true,
      cacheTtlMs: 60 * 1000,
      requestTimeout: "10s",
    });
    expect(result.status).toBe("warning");
    expect(result.summary.message).toContain("p99 = 1.00 s");
    expect(result.groups.every((group) => group.verb !== "WATCH")).toBe(true);
  });
});
