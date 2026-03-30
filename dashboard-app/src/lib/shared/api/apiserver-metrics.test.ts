import { beforeEach, describe, expect, it, vi } from "vitest";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  fetchApiserverMetrics,
  getApiserverMetricsCacheSnapshot,
  resetApiserverMetricsCache,
} from "./apiserver-metrics";
import {
  resetClusterRuntimeContext,
  setClusterRuntimeBudget,
  setClusterRuntimeOverride,
} from "$shared/lib/cluster-runtime-manager";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

describe("apiserver-metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiserverMetricsCache();
    resetClusterRuntimeContext();
  });

  it("reuses cached metrics for reuse_only policy even when force is requested", async () => {
    vi.mocked(kubectlRawArgsFront).mockResolvedValue({
      code: 0,
      output: "metric 1\n",
      errors: "",
    });
    setClusterRuntimeBudget({ metricsReadPolicy: "reuse_only" });

    const first = await fetchApiserverMetrics("cluster-a", { force: true, cacheTtlMs: 1_000 });
    const second = await fetchApiserverMetrics("cluster-a", { force: true, cacheTtlMs: 1_000 });

    expect(first).toEqual({ output: "metric 1\n", error: null });
    expect(second).toEqual(first);
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);
    expect(getApiserverMetricsCacheSnapshot("cluster-a")?.result).toEqual(first);
  });

  it("allows per-cluster eager policy to bypass cache on forced reads", async () => {
    vi.mocked(kubectlRawArgsFront)
      .mockResolvedValueOnce({
        code: 0,
        output: "metric 1\n",
        errors: "",
      })
      .mockResolvedValueOnce({
        code: 0,
        output: "metric 2\n",
        errors: "",
      });
    setClusterRuntimeOverride("cluster-a", { metricsReadPolicy: "eager" });

    const first = await fetchApiserverMetrics("cluster-a", { force: true });
    const second = await fetchApiserverMetrics("cluster-a", { force: true });

    expect(first.output).toBe("metric 1\n");
    expect(second.output).toBe("metric 2\n");
    expect(kubectlRawArgsFront).toHaveBeenCalledTimes(2);
  });
});
