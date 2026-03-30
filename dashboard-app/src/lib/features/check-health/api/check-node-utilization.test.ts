import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkNodeUtilization } from "./check-node-utilization";

const mockedKubectl = vi.mocked(kubectlRawFront);

describe("checkNodeUtilization", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when all nodes are under 75%", async () => {
    mockedKubectl.mockResolvedValue({
      output: ["node-1   250m   12%   1024Mi   45%", "node-2   400m   20%   2048Mi   60%"].join(
        "\n",
      ),
      errors: "",
      code: 0,
    });

    const result = await checkNodeUtilization(clusterId, { force: true });

    expect(result.status).toBe("ok");
    expect(result.summary.nodeCount).toBe(2);
    expect(result.summary.maxCpuPercent).toBe(20);
    expect(result.summary.maxMemoryPercent).toBe(60);
    expect(result.summary.avgCpuPercent).toBe(16);
    expect(result.summary.avgMemoryPercent).toBe(53);
    expect(result.nodes).toHaveLength(2);
  });

  it("returns warning when a node exceeds 75%", async () => {
    mockedKubectl.mockResolvedValue({
      output: ["node-1   250m   12%   1024Mi   45%", "node-2   1500m  80%   4096Mi   78%"].join(
        "\n",
      ),
      errors: "",
      code: 0,
    });

    const result = await checkNodeUtilization(clusterId, { force: true });

    expect(result.status).toBe("warning");
    expect(result.summary.maxCpuPercent).toBe(80);
    expect(result.summary.maxMemoryPercent).toBe(78);
  });

  it("returns critical when a node exceeds 90%", async () => {
    mockedKubectl.mockResolvedValue({
      output: ["node-1   250m   12%   1024Mi   45%", "node-2   1900m  95%   4096Mi   88%"].join(
        "\n",
      ),
      errors: "",
      code: 0,
    });

    const result = await checkNodeUtilization(clusterId, { force: true });

    expect(result.status).toBe("critical");
    expect(result.summary.maxCpuPercent).toBe(95);
  });

  it("returns unknown when metrics-server is not installed", async () => {
    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "error: Metrics API not available",
      code: 1,
    });

    const result = await checkNodeUtilization(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.summary.nodeCount).toBe(0);
  });

  it("returns unknown on thrown error", async () => {
    mockedKubectl.mockRejectedValue(new Error("network failure"));

    const result = await checkNodeUtilization(clusterId, { force: true });

    expect(result.status).toBe("unknown");
  });
});
