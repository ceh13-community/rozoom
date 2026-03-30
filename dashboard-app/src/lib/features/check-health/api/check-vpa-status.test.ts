import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawFrontMock = vi.fn();
const loadClusterEntitiesMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: loadClusterEntitiesMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

describe("check-vpa-status", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    kubectlRawFrontMock.mockReset();
    loadClusterEntitiesMock.mockReset();
    logErrorMock.mockReset();
    const { resetFeatureCapabilityCache } = await import("../model/feature-capability-cache");
    resetFeatureCapabilityCache();
  });

  it("reuses feature capability cache for unsupported VPA resources after report cache expires", async () => {
    loadClusterEntitiesMock.mockResolvedValue({
      status: "ok",
      deployments: { items: [] },
      statefulsets: { items: [] },
    });
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: "",
        errors: 'error: the server doesn\'t have a resource type "verticalpodautoscalers"',
        code: 1,
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
        code: 0,
      });

    const { checkVpaStatus } = await import("./check-vpa-status");

    const first = await checkVpaStatus("cluster-vpa");
    expect(first.status).toBe("warning");
    expect(first.errors).toBe("VPA not installed in this cluster.");
    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(61_000);
    const second = await checkVpaStatus("cluster-vpa");

    expect(second.status).toBe("warning");
    expect(second.errors).toContain("verticalpodautoscalers");
    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(2);
    expect(loadClusterEntitiesMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
