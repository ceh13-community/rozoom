import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawFrontMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

describe("check-resource-quotas", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    kubectlRawFrontMock.mockReset();
    logErrorMock.mockReset();
  });

  it("parses resource quotas output correctly", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output:
        "default   my-quota   1   500m   1Gi   256Mi\nkube-system   sys-quota   2   1   2Gi   512Mi\n",
      errors: "",
      code: 0,
    });

    const { checkResourceQuotas } = await import("./check-resource-quotas");
    const report = await checkResourceQuotas("cluster-1");

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(2);
    expect(report.items[0]).toEqual({
      namespace: "default",
      name: "my-quota",
      hardCpu: "1",
      usedCpu: "500m",
      hardMemory: "1Gi",
      usedMemory: "256Mi",
    });
    expect(report.items[1]).toEqual({
      namespace: "kube-system",
      name: "sys-quota",
      hardCpu: "2",
      usedCpu: "1",
      hardMemory: "2Gi",
      usedMemory: "512Mi",
    });
    expect(report.summary.total).toBe(2);
    expect(report.summary.namespacesWithQuotas).toBe(2);
  });

  it("returns warning when output is empty", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "",
      errors: "",
      code: 0,
    });

    const { checkResourceQuotas } = await import("./check-resource-quotas");
    const report = await checkResourceQuotas("cluster-2");

    expect(report.status).toBe("warning");
    expect(report.items).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });

  it("handles errors gracefully", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const { checkResourceQuotas } = await import("./check-resource-quotas");
    const report = await checkResourceQuotas("cluster-3");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles thrown errors gracefully", async () => {
    kubectlRawFrontMock.mockRejectedValueOnce(new Error("network error"));

    const { checkResourceQuotas } = await import("./check-resource-quotas");
    const report = await checkResourceQuotas("cluster-4");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("uses cache within 60s", async () => {
    kubectlRawFrontMock.mockResolvedValue({
      output: "default   my-quota   1   500m   1Gi   256Mi\n",
      errors: "",
      code: 0,
    });

    const { checkResourceQuotas } = await import("./check-resource-quotas");
    await checkResourceQuotas("cluster-5");
    await checkResourceQuotas("cluster-5");

    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(1);
  });
});
