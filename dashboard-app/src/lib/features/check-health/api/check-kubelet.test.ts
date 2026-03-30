import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkKubelet, resetCheckKubeletCache } from "./check-kubelet";
import { resetFeatureCapabilityCache } from "../model/feature-capability-cache";

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

vi.mock("@/lib/shared/api/tauri", () => ({
  getClusterNodesNames: vi.fn(),
}));

vi.mock("@/lib/shared/lib/parsers", () => ({
  checkResponseStatus: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { getClusterNodesNames } from "$shared/api/tauri";
import { checkResponseStatus } from "$shared/lib/parsers";

const mockedKubectlRawFront = vi.mocked(kubectlRawFront);
const mockedGetClusterNodesNames = vi.mocked(getClusterNodesNames);
const mockedCheckResponseStatus = vi.mocked(checkResponseStatus);

describe("checkKubelet", () => {
  const clusterId = "test-cluster";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2025-12-11T10:00:00Z"));
    resetCheckKubeletCache();
    resetFeatureCapabilityCache();
  });

  it("should return error when cluster has no nodes", async () => {
    mockedGetClusterNodesNames.mockResolvedValue([]);

    const result = await checkKubelet(clusterId);

    expect(result).toEqual({
      error: "Cluster has no nodes",
      lastSync: "2025-12-11T10:00:00.000Z",
      status: [{ nodeName: "", result: -1 }],
      title: "Kubelet",
    });

    expect(getClusterNodesNames).toHaveBeenCalledWith(clusterId);
    expect(kubectlRawFront).not.toHaveBeenCalled();
  });

  it("should use provided nodesNames instead of fetching them", async () => {
    const nodesNames = ["node-1", "node-2"];
    mockedKubectlRawFront.mockResolvedValue({
      output: "ok",
      errors: "",
    });

    const result = await checkKubelet(clusterId, nodesNames);

    expect(getClusterNodesNames).not.toHaveBeenCalled();
    expect(kubectlRawFront).toHaveBeenCalledTimes(2);
    expect(kubectlRawFront).toHaveBeenCalledWith("get --raw /api/v1/nodes/node-1/proxy/healthz", {
      clusterId,
    });
    expect(kubectlRawFront).toHaveBeenCalledWith("get --raw /api/v1/nodes/node-2/proxy/healthz", {
      clusterId,
    });

    expect(result.status).toEqual([
      { nodeName: "node-1", result: 1 },
      { nodeName: "node-2", result: 1 },
    ]);
    expect(result.title).toBe("Kubelet");
    expect(result.lastSync).toBe("2025-12-11T10:00:00.000Z");
    expect(result.url).toBe("/api/v1/nodes/node-2/proxy/metrics/");
  });

  it("should detect healthy kubelet via healthz endpoint", async () => {
    mockedGetClusterNodesNames.mockResolvedValue(["node-ok"]);
    mockedKubectlRawFront.mockResolvedValue({
      output: "ok",
      errors: "",
    });

    const result = await checkKubelet(clusterId);

    expect(result.status).toEqual([{ nodeName: "node-ok", result: 1 }]);
    expect(result.error).toBeUndefined();
  });

  it("should mark node as unhealthy when healthz returns unexpected response", async () => {
    mockedGetClusterNodesNames.mockResolvedValue(["node-bad"]);
    mockedKubectlRawFront.mockResolvedValue({
      output: "some random text",
      errors: "",
    });

    const result = await checkKubelet(clusterId);

    expect(result.status).toEqual([{ nodeName: "node-bad", result: 0 }]);
    expect(result.error).toContain("Kubelet healthz returned unexpected response on node node-bad");
  });

  it("should handle API errors via checkResponseStatus", async () => {
    const errorMessage = "Unauthorized";
    mockedGetClusterNodesNames.mockResolvedValue(["node-error"]);
    mockedKubectlRawFront.mockResolvedValue({
      output: "",
      errors: errorMessage,
    });
    mockedCheckResponseStatus.mockReturnValue(0);

    const result = await checkKubelet(clusterId);

    expect(checkResponseStatus).toHaveBeenCalledWith(errorMessage);
    expect(kubectlRawFront).toHaveBeenCalledWith(
      "get --raw /api/v1/nodes/node-error/proxy/healthz",
      {
        clusterId,
      },
    );
    expect(result).toEqual({
      error: errorMessage,
      lastSync: "2025-12-11T10:00:00.000Z",
      status: [{ nodeName: "node-error", result: 0 }],
      title: "Kubelet",
    });
  });
});
