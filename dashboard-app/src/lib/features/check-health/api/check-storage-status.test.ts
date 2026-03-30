import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawFrontMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

describe("check-storage-status", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    kubectlRawFrontMock.mockReset();
    logErrorMock.mockReset();
  });

  it("parses storage classes and PVCs correctly", async () => {
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: "standard   kubernetes.io/gce-pd   true\nfast   kubernetes.io/ssd   <none>\n",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output:
          "default   data-pvc   Bound   10Gi\ndefault   logs-pvc   Bound   5Gi\nstaging   pending-pvc   Pending   <none>\n",
        errors: "",
        code: 0,
      });

    const { checkStorageStatus } = await import("./check-storage-status");
    const report = await checkStorageStatus("cluster-1");

    expect(report.status).toBe("warning");
    expect(report.summary.storageClasses).toBe(2);
    expect(report.summary.totalPVCs).toBe(3);
    expect(report.summary.boundPVCs).toBe(2);
    expect(report.summary.pendingPVCs).toBe(1);
    expect(report.summary.lostPVCs).toBe(0);
  });

  it("returns critical when PVCs are Lost", async () => {
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: "standard   kubernetes.io/gce-pd   true\n",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "default   data-pvc   Lost   10Gi\n",
        errors: "",
        code: 0,
      });

    const { checkStorageStatus } = await import("./check-storage-status");
    const report = await checkStorageStatus("cluster-2");

    expect(report.status).toBe("critical");
    expect(report.summary.lostPVCs).toBe(1);
  });

  it("returns ok when all PVCs are Bound", async () => {
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: "standard   kubernetes.io/gce-pd   true\n",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "default   data-pvc   Bound   10Gi\n",
        errors: "",
        code: 0,
      });

    const { checkStorageStatus } = await import("./check-storage-status");
    const report = await checkStorageStatus("cluster-3");

    expect(report.status).toBe("ok");
    expect(report.summary.boundPVCs).toBe(1);
  });

  it("handles empty output", async () => {
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      });

    const { checkStorageStatus } = await import("./check-storage-status");
    const report = await checkStorageStatus("cluster-4");

    expect(report.status).toBe("ok");
    expect(report.summary.storageClasses).toBe(0);
    expect(report.summary.totalPVCs).toBe(0);
  });

  it("handles errors gracefully", async () => {
    kubectlRawFrontMock.mockRejectedValueOnce(new Error("network error"));

    const { checkStorageStatus } = await import("./check-storage-status");
    const report = await checkStorageStatus("cluster-5");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("uses cache within 60s", async () => {
    kubectlRawFrontMock
      .mockResolvedValueOnce({
        output: "standard   kubernetes.io/gce-pd   true\n",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "default   data-pvc   Bound   10Gi\n",
        errors: "",
        code: 0,
      });

    const { checkStorageStatus } = await import("./check-storage-status");
    await checkStorageStatus("cluster-6");
    await checkStorageStatus("cluster-6");

    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(2);
  });
});
