import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchApiserverMetrics } from "$shared/api/apiserver-metrics";
import { checkAdmissionWebhooks } from "./check-admission-webhooks";

vi.mock("$shared/api/apiserver-metrics");
vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

const mockedFetchApiserverMetrics = vi.mocked(fetchApiserverMetrics);

describe("checkAdmissionWebhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads admission webhook metrics through the shared apiserver metrics fetch", async () => {
    mockedFetchApiserverMetrics.mockResolvedValue({
      output: [
        'apiserver_admission_webhook_admission_duration_seconds_bucket{name="validate-pods",operation="CREATE",type="validating",le="1"} 10',
        'apiserver_admission_webhook_admission_duration_seconds_bucket{name="validate-pods",operation="CREATE",type="validating",le="5"} 10',
        'apiserver_admission_webhook_admission_duration_seconds_bucket{name="validate-pods",operation="CREATE",type="validating",le="+Inf"} 10',
        'apiserver_admission_webhook_rejection_count{name="validate-pods",operation="CREATE",type="validating"} 2',
      ].join("\n"),
      error: null,
    });

    const result = await checkAdmissionWebhooks("cluster-a", { force: true });

    expect(mockedFetchApiserverMetrics).toHaveBeenCalledWith("cluster-a", {
      force: true,
      cacheTtlMs: 60 * 1000,
      requestTimeout: "10s",
    });
    expect(result.summary.message).toContain("Admission webhooks p99");
    expect(result.items).toHaveLength(1);
  });
});
