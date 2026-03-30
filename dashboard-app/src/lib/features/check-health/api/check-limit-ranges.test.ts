import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawFrontMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

describe("check-limit-ranges", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    kubectlRawFrontMock.mockReset();
    logErrorMock.mockReset();
  });

  it("parses limit ranges output correctly", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "default   default-limits\nproduction   prod-limits\n",
      errors: "",
      code: 0,
    });

    const { checkLimitRanges } = await import("./check-limit-ranges");
    const report = await checkLimitRanges("cluster-1");

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(2);
    expect(report.items[0]).toEqual({ namespace: "default", name: "default-limits" });
    expect(report.items[1]).toEqual({ namespace: "production", name: "prod-limits" });
    expect(report.summary.total).toBe(2);
    expect(report.summary.namespacesWithLimits).toBe(2);
  });

  it("returns warning when output is empty", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "",
      errors: "",
      code: 0,
    });

    const { checkLimitRanges } = await import("./check-limit-ranges");
    const report = await checkLimitRanges("cluster-2");

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

    const { checkLimitRanges } = await import("./check-limit-ranges");
    const report = await checkLimitRanges("cluster-3");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles thrown errors gracefully", async () => {
    kubectlRawFrontMock.mockRejectedValueOnce(new Error("network error"));

    const { checkLimitRanges } = await import("./check-limit-ranges");
    const report = await checkLimitRanges("cluster-4");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("uses cache within 60s", async () => {
    kubectlRawFrontMock.mockResolvedValue({
      output: "default   default-limits\n",
      errors: "",
      code: 0,
    });

    const { checkLimitRanges } = await import("./check-limit-ranges");
    await checkLimitRanges("cluster-5");
    await checkLimitRanges("cluster-5");

    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(1);
  });
});
