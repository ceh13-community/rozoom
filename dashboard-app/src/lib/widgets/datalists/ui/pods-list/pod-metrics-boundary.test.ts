import { render, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PodMetricsBoundary from "./pod-metrics-boundary.svelte";

const kubectlRawArgsFront = vi.hoisted(() => vi.fn());

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("pod metrics boundary", () => {
  beforeEach(() => {
    kubectlRawArgsFront.mockReset();
  });

  it("ignores stale metrics responses after a newer refresh starts", async () => {
    const first = deferred<{ output: string; errors?: string; code?: number }>();
    const second = deferred<{ output: string; errors?: string; code?: number }>();
    kubectlRawArgsFront.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const metricsChanges: Array<Map<string, { cpu: string; memory: string }>> = [];
    const { rerender } = render(PodMetricsBoundary, {
      props: {
        clusterId: "cluster-a",
        pods: [{ metadata: { namespace: "default", name: "api-0", uid: "pod-1" } }],
        refreshToken: 1,
        onMetricsChange: (metrics: Map<string, { cpu: string; memory: string }>) => {
          metricsChanges.push(new Map(metrics));
        },
        onMetricsErrorChange: vi.fn(),
        onMetricsLoadingChange: vi.fn(),
      },
    });

    await rerender({
      clusterId: "cluster-a",
      pods: [{ metadata: { namespace: "default", name: "api-0", uid: "pod-1" } }],
      refreshToken: 2,
      onMetricsChange: (metrics: Map<string, { cpu: string; memory: string }>) => {
        metricsChanges.push(new Map(metrics));
      },
      onMetricsErrorChange: vi.fn(),
      onMetricsLoadingChange: vi.fn(),
    });

    second.resolve({ output: "default api-0 15m 64Mi", errors: "", code: 0 });
    await waitFor(() => {
      expect(metricsChanges.at(-1)?.get("default/api-0")?.cpu).toBe("15m");
    });

    first.resolve({ output: "default api-0 99m 512Mi", errors: "", code: 0 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(metricsChanges.at(-1)?.get("default/api-0")?.cpu).toBe("15m");
  });
});
