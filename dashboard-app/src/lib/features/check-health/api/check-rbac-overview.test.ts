import { beforeEach, describe, expect, it, vi } from "vitest";

const kubectlRawFrontMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: kubectlRawFrontMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

describe("check-rbac-overview", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    kubectlRawFrontMock.mockReset();
    logErrorMock.mockReset();
  });

  it("parses RBAC bindings and detects overprivileged users", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output:
        "cluster-admin-binding   cluster-admin   admin-user\nsystem-binding   cluster-admin   system:masters\nreadonly-binding   view   dev-user\n",
      errors: "",
      code: 0,
    });

    const { checkRbacOverview } = await import("./check-rbac-overview");
    const report = await checkRbacOverview("cluster-1");

    expect(report.status).toBe("warning");
    expect(report.summary.totalBindings).toBe(3);
    expect(report.summary.clusterAdminBindings).toBe(2);
    expect(report.summary.overprivilegedCount).toBe(1);
  });

  it("returns ok when no overprivileged bindings exist", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output:
        "system-binding   cluster-admin   system:masters\nreadonly-binding   view   dev-user\n",
      errors: "",
      code: 0,
    });

    const { checkRbacOverview } = await import("./check-rbac-overview");
    const report = await checkRbacOverview("cluster-2");

    expect(report.status).toBe("ok");
    expect(report.summary.overprivilegedCount).toBe(0);
  });

  it("handles empty output", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "",
      errors: "",
      code: 0,
    });

    const { checkRbacOverview } = await import("./check-rbac-overview");
    const report = await checkRbacOverview("cluster-3");

    expect(report.status).toBe("ok");
    expect(report.summary.totalBindings).toBe(0);
  });

  it("handles errors gracefully", async () => {
    kubectlRawFrontMock.mockResolvedValueOnce({
      output: "",
      errors: "forbidden",
      code: 1,
    });

    const { checkRbacOverview } = await import("./check-rbac-overview");
    const report = await checkRbacOverview("cluster-4");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles thrown errors gracefully", async () => {
    kubectlRawFrontMock.mockRejectedValueOnce(new Error("network error"));

    const { checkRbacOverview } = await import("./check-rbac-overview");
    const report = await checkRbacOverview("cluster-5");

    expect(report.status).toBe("unknown");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("uses cache within 60s", async () => {
    kubectlRawFrontMock.mockResolvedValue({
      output: "system-binding   cluster-admin   system:masters\n",
      errors: "",
      code: 0,
    });

    const { checkRbacOverview } = await import("./check-rbac-overview");
    await checkRbacOverview("cluster-6");
    await checkRbacOverview("cluster-6");

    expect(kubectlRawFrontMock).toHaveBeenCalledTimes(1);
  });
});
