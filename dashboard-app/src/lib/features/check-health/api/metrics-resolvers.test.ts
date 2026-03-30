import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cpuRamFromKubeletSummary,
  cpuRamFromPrometheus,
  diskFromKubeletSummary,
  diskFromPrometheus,
} from "./metrics-resolvers";
import * as kubectlProxy from "$shared/api/kubectl-proxy";
import * as cpuMemKubelet from "$shared/metrics/resolvers/cpu-mem.kubelet";
import * as discoverPrometheus from "$shared/api/discover-prometheus";

vi.mock("@/lib/shared/api/kubectl-proxy");
vi.mock("@/lib/shared/metrics/resolvers/cpu-mem.kubelet");
vi.mock("@/lib/shared/api/discover-prometheus");

describe("MetricResolver - cpuRamFromKubeletSummary", () => {
  const mockClusterId = "test-cluster-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockNodesResponse = (
    nodes: Array<{
      name: string;
      cpuAllocatable: string;
      memoryAllocatable: string;
    }>,
  ) => ({
    items: nodes.map((node) => ({
      metadata: {
        name: node.name,
      },
      status: {
        allocatable: {
          cpu: node.cpuAllocatable,
          memory: node.memoryAllocatable,
        },
      },
    })),
  });

  const createMockSummaryResponse = (
    cpuUsageNanoCores: number,
    memoryWorkingSetBytes: number,
    fsAvailableBytes?: number,
  ) => ({
    node: {
      cpu: {
        usageNanoCores: cpuUsageNanoCores,
      },
      memory: {
        workingSetBytes: memoryWorkingSetBytes,
      },
      ...(fsAvailableBytes !== undefined && {
        fs: {
          availableBytes: fsAvailableBytes,
        },
      }),
    },
  });

  describe("canResolve", () => {
    it("should return true when kubectl get nodes succeeds", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "",
      });

      const result = await cpuRamFromKubeletSummary.canResolve({ clusterId: mockClusterId });

      expect(result).toBe(true);
      expect(kubectlProxy.kubectlRawFront).toHaveBeenCalledWith("get nodes", {
        clusterId: mockClusterId,
      });
    });

    it("should return false when kubectl get nodes fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Connection refused",
      });

      const result = await cpuRamFromKubeletSummary.canResolve({ clusterId: mockClusterId });

      expect(result).toBe(false);
    });

    it("should return false when kubectl returns multiple errors", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Error 1\nError 2",
      });

      const result = await cpuRamFromKubeletSummary.canResolve({ clusterId: mockClusterId });

      expect(result).toBe(false);
    });
  });

  describe("resolve - single node", () => {
    it("should return CPU and memory percentages for a specific node", async () => {
      const nodeName = "worker-node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      const summaryResponse = createMockSummaryResponse(
        2_000_000_000, // 2 cores in nanocores
        4_294_967_296, // 4 GiB in bytes
      );

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592); // 8 GiB

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "50%", // 2/4 cores
        memory: "50%", // 4/8 GiB
      });
    });

    it("should handle CPU values in millicores", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "2000m", memoryAllocatable: "4Gi" },
      ]);

      const summaryResponse = createMockSummaryResponse(
        1_000_000_000, // 1 core
        2_147_483_648, // 2 GiB
      );

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(4_294_967_296);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "50%",
        memory: "50%",
      });
    });

    it("should return 0% when allocatable resources are zero", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "0", memoryAllocatable: "0" },
      ]);

      const summaryResponse = createMockSummaryResponse(1_000_000_000, 1_073_741_824);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(0);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "0%",
        memory: "0%",
      });
    });

    it("should cap percentages at 100%", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "1", memoryAllocatable: "1Gi" },
      ]);

      const summaryResponse = createMockSummaryResponse(
        5_000_000_000, // 5 cores (more than allocatable)
        5_368_709_120, // 5 GiB
      );

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(1_073_741_824);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "100%",
        memory: "100%",
      });
    });

    it("should handle missing CPU usage data", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      const summaryResponse = {
        node: {
          memory: {
            workingSetBytes: 4_294_967_296,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "0%",
        memory: "50%",
      });
    });

    it("should handle missing memory usage data", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      const summaryResponse = {
        node: {
          cpu: {
            usageNanoCores: 2_000_000_000,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "50%",
        memory: "0%",
      });
    });

    it("should handle missing allocatable data", async () => {
      const nodeName = "node-1";
      const nodesResponse = {
        items: [
          {
            metadata: {
              name: nodeName,
            },
            status: {},
          },
        ],
      };

      const summaryResponse = createMockSummaryResponse(2_000_000_000, 4_294_967_296);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(0);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "0%",
        memory: "0%",
      });
    });

    it("should throw error when getting nodes fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Failed to connect",
      });

      await expect(
        cpuRamFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName: "node-1",
        }),
      ).rejects.toThrow("Failed to connect");
    });

    it("should throw error when getting summary fails", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: "",
          errors: "Summary endpoint unavailable",
        });

      await expect(
        cpuRamFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName,
        }),
      ).rejects.toThrow("Summary endpoint unavailable");
    });
  });

  describe("resolve - multiple nodes", () => {
    it("should return metrics for all nodes when nodeName is not provided", async () => {
      const nodesResponse = createMockNodesResponse([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
        { name: "node-2", cpuAllocatable: "2", memoryAllocatable: "4Gi" },
      ]);

      const summary1 = createMockSummaryResponse(2_000_000_000, 4_294_967_296);
      const summary2 = createMockSummaryResponse(1_000_000_000, 2_147_483_648);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summary1),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summary2),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes)
        .mockReturnValueOnce(8_589_934_592)
        .mockReturnValueOnce(4_294_967_296);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        { name: "node-1", cpu: "50%", memory: "50%" },
        { name: "node-2", cpu: "50%", memory: "50%" },
      ]);
    });

    it("should return empty array when no nodes exist", async () => {
      const nodesResponse = { items: [] };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(nodesResponse),
        errors: "",
      });

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toEqual([]);
    });

    it("should skip nodes with invalid metadata", async () => {
      const nodesResponse = {
        items: [
          {
            metadata: {
              name: "valid-node",
            },
            status: {
              allocatable: {
                cpu: "4",
                memory: "8Gi",
              },
            },
          },
          {
            // Missing metadata
            status: {
              allocatable: {
                cpu: "2",
                memory: "4Gi",
              },
            },
          },
          {
            metadata: {
              // Missing name
            },
            status: {
              allocatable: {
                cpu: "2",
                memory: "4Gi",
              },
            },
          },
        ],
      };

      const summaryResponse = createMockSummaryResponse(2_000_000_000, 4_294_967_296);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toHaveLength(1);
      expect(Array.isArray(result) && result?.length > 0 && result[0].name).toBe("valid-node");
    });

    it("should handle non-object items in nodes array", async () => {
      const nodesResponse = {
        items: [
          "invalid",
          null,
          {
            metadata: {
              name: "valid-node",
            },
            status: {
              allocatable: {
                cpu: "4",
                memory: "8Gi",
              },
            },
          },
        ],
      };

      const summaryResponse = createMockSummaryResponse(2_000_000_000, 4_294_967_296);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toHaveLength(1);
      expect(Array.isArray(result) && result?.length > 0 && result[0].name).toBe("valid-node");
    });
  });

  describe("edge cases", () => {
    it("should handle invalid JSON in nodes response", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "invalid json {",
        errors: "",
      });

      await expect(
        cpuRamFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName: "node-1",
        }),
      ).rejects.toThrow();
    });

    it("should handle invalid JSON in summary response", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: "invalid json {",
          errors: "",
        });

      await expect(
        cpuRamFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName,
        }),
      ).rejects.toThrow();
    });

    it("should handle non-object nodes response", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify("not an object"),
        errors: "",
      });

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toEqual([]);
    });

    it("should handle nodes response without items array", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({ notItems: [] }),
        errors: "",
      });

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toEqual([]);
    });

    it("should handle summary response without node object", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({ notNode: {} }),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "0%",
        memory: "0%",
      });
    });

    it("should handle non-numeric usage values", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      const summaryResponse = {
        node: {
          cpu: {
            usageNanoCores: "invalid",
          },
          memory: {
            workingSetBytes: "invalid",
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(8_589_934_592);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "0%",
        memory: "0%",
      });
    });

    it("should handle NaN and Infinity in allocatable values", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([
        { name: nodeName, cpuAllocatable: "invalid", memoryAllocatable: "invalid" },
      ]);

      const summaryResponse = createMockSummaryResponse(2_000_000_000, 4_294_967_296);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      vi.mocked(cpuMemKubelet.parseBytes).mockReturnValue(NaN);

      const result = await cpuRamFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        cpu: "0%",
        memory: "0%",
      });
    });
  });

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(cpuRamFromKubeletSummary.id).toBe("cpu-ram-kubelet-summary");
    });

    it("should have correct title", () => {
      expect(cpuRamFromKubeletSummary.title).toBe("Kubelet Summary");
    });
  });
});

describe("MetricResolver - cpuRamFromPrometheus", () => {
  describe("canResolve", () => {
    it("should return true when prometheus service is discovered", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });

      const result = await cpuRamFromPrometheus.canResolve({ clusterId: "any-cluster" });
      expect(result).toBe(true);
    });

    it("should return false when prometheus service is not discovered", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(null);

      const result = await cpuRamFromPrometheus.canResolve({ clusterId: "any-cluster" });
      expect(result).toBe(false);
    });
  });

  describe("resolve", () => {
    it("should resolve cpu and memory for all nodes", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify({
            items: [{ metadata: { name: "node-1" } }, { metadata: { name: "node-2" } }],
          }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({
            status: "success",
            data: {
              resultType: "vector",
              result: [
                { metric: { instance: "node-1:9100" }, value: [0, "42.1"] },
                { metric: { instance: "node-2:9100" }, value: [0, "19.9"] },
              ],
            },
          }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({
            status: "success",
            data: {
              resultType: "vector",
              result: [
                { metric: { instance: "node-1:9100" }, value: [0, "55.2"] },
                { metric: { instance: "node-2:9100" }, value: [0, "60.8"] },
              ],
            },
          }),
          errors: "",
        });

      const result = await cpuRamFromPrometheus.resolve({ clusterId: "any-cluster" });

      expect(result).toEqual([
        { name: "node-1", cpu: "42%", memory: "55%" },
        { name: "node-2", cpu: "20%", memory: "61%" },
      ]);
    });

    it("should resolve a single node when nodeName is provided", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric: { instance: "node-1:9100" }, value: [0, "30"] }],
            },
          }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({
            status: "success",
            data: {
              resultType: "vector",
              result: [{ metric: { instance: "node-1:9100" }, value: [0, "64"] }],
            },
          }),
          errors: "",
        });

      const result = await cpuRamFromPrometheus.resolve({
        clusterId: "any-cluster",
        nodeName: "node-1",
      });

      expect(result).toEqual({ name: "node-1", cpu: "30%", memory: "64%" });
    });

    it("should throw when no metrics are returned", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify({
            items: [{ metadata: { name: "node-1" } }],
          }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({ status: "success", data: { result: [] } }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({ status: "success", data: { result: [] } }),
          errors: "",
        });

      await expect(cpuRamFromPrometheus.resolve({ clusterId: "any-cluster" })).rejects.toThrow(
        "Prometheus returned no CPU/RAM data",
      );
    });
  });

  describe("metadata", () => {
    it("should have correct id", () => {
      expect(cpuRamFromPrometheus.id).toBe("cpu-ram-prometheus");
    });

    it("should have correct title", () => {
      expect(cpuRamFromPrometheus.title).toBe("Prometheus");
    });
  });
});

describe("MetricResolver - diskFromKubeletSummary", () => {
  const mockClusterId = "test-cluster-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockNodesResponse = (nodeNames: string[]) => ({
    items: nodeNames.map((name) => ({
      metadata: { name },
    })),
  });

  const createMockSummaryWithFs = (availableBytes: number) => ({
    node: {
      fs: {
        availableBytes,
      },
    },
  });

  describe("canResolve", () => {
    it("should return true when kubectl get nodes succeeds", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "",
      });

      const result = await diskFromKubeletSummary.canResolve({ clusterId: mockClusterId });

      expect(result).toBe(true);
    });

    it("should return false when kubectl get nodes fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Connection failed",
      });

      const result = await diskFromKubeletSummary.canResolve({ clusterId: mockClusterId });

      expect(result).toBe(false);
    });
  });

  describe("resolve - single node", () => {
    it("should return disk free space in GiB for a specific node", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = createMockSummaryWithFs(107_374_182_400); // 100 GiB

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        freeGiB: 100,
      });
    });

    it("should round freeGiB to 2 decimal places", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = createMockSummaryWithFs(1_610_612_736); // ~1.5 GiB

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(1.5);
    });

    it("should handle fs.available.bytes structure", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            available: {
              bytes: 53_687_091_200, // 50 GiB
            },
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(50);
    });

    it("should handle fs.available as direct number", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            available: 32_212_254_720, // 30 GiB
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(30);
    });

    it("should handle fs.available_bytes structure", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            available_bytes: 21_474_836_480, // 20 GiB
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(20);
    });

    it("should prioritize availableBytes over other fields", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            availableBytes: 10_737_418_240, // 10 GiB
            available: {
              bytes: 5_368_709_120, // 5 GiB (should be ignored)
            },
            available_bytes: 2_147_483_648, // 2 GiB (should be ignored)
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(10);
    });

    it("should return 0 when fs data is missing", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {},
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(result).toEqual({
        name: nodeName,
        freeGiB: 0,
      });
    });

    it("should return 0 when node object is missing", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {};

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(0);
    });

    it("should throw error when getting nodes fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Failed to get nodes",
      });

      await expect(
        diskFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName: "node-1",
        }),
      ).rejects.toThrow("Failed to get nodes");
    });

    it("should throw error when getting summary fails", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: "",
          errors: "Summary unavailable",
        });

      await expect(
        diskFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName,
        }),
      ).rejects.toThrow("Summary unavailable");
    });
  });
  describe("resolve - multiple nodes", () => {
    it("should return disk metrics for all nodes", async () => {
      const nodesResponse = createMockNodesResponse(["node-1", "node-2", "node-3"]);
      const summary1 = createMockSummaryWithFs(107_374_182_400); // 100 GiB
      const summary2 = createMockSummaryWithFs(53_687_091_200); // 50 GiB
      const summary3 = createMockSummaryWithFs(10_737_418_240); // 10 GiB

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summary1),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summary2),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summary3),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toEqual([
        { name: "node-1", freeGiB: 100 },
        { name: "node-2", freeGiB: 50 },
        { name: "node-3", freeGiB: 10 },
      ]);
    });

    it("should return empty array when no nodes exist", async () => {
      const nodesResponse = { items: [] };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(nodesResponse),
        errors: "",
      });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toEqual([]);
    });

    it("should skip nodes with invalid metadata", async () => {
      const nodesResponse = {
        items: [
          { metadata: { name: "valid-node" } },
          { metadata: {} },
          { notMetadata: { name: "invalid" } },
          null,
          "string",
        ],
      };

      const summaryResponse = createMockSummaryWithFs(10_737_418_240);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
      });

      expect(result).toHaveLength(1);
      expect(Array.isArray(result) && result?.length > 0 && result[0].name).toBe("valid-node");
    });
  });
  describe("edge cases", () => {
    it("should handle non-numeric availableBytes", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            availableBytes: "invalid",
          },
        },
      };
      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(0);
    });

    it("should handle Infinity in availableBytes", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            availableBytes: Infinity,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(0);
    });

    it("should handle NaN in availableBytes", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = {
        node: {
          fs: {
            availableBytes: NaN,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(0);
    });

    it("should handle zero availableBytes", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = createMockSummaryWithFs(0);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(0);
    });

    it("should handle very large availableBytes values", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);
      const summaryResponse = createMockSummaryWithFs(1_099_511_627_776); // 1 TiB

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(summaryResponse),
          errors: "",
        });

      const result = await diskFromKubeletSummary.resolve({
        clusterId: mockClusterId,
        nodeName,
      });

      expect(!Array.isArray(result) && result.freeGiB).toBe(1024);
    });

    it("should handle invalid JSON in summary response", async () => {
      const nodeName = "node-1";
      const nodesResponse = createMockNodesResponse([nodeName]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(nodesResponse),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: "invalid json",
          errors: "",
        });

      await expect(
        diskFromKubeletSummary.resolve({
          clusterId: mockClusterId,
          nodeName,
        }),
      ).rejects.toThrow();
    });
  });
  describe("metadata", () => {
    it("should have correct id", () => {
      expect(diskFromKubeletSummary.id).toBe("disk-kubelet-summary");
    });
    it("should have correct title", () => {
      expect(diskFromKubeletSummary.title).toBe("Kubelet Summary (node.fs)");
    });
  });
});
describe("MetricResolver - diskFromPrometheus", () => {
  describe("canResolve", () => {
    it("should return true when prometheus service is discovered", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      const result = await diskFromPrometheus.canResolve({ clusterId: "any-cluster" });
      expect(result).toBe(true);
    });

    it("should return false when prometheus service is not discovered", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue(null);
      const result = await diskFromPrometheus.canResolve({ clusterId: "any-cluster" });
      expect(result).toBe(false);
    });
  });
  describe("resolve", () => {
    it("should resolve disk free GiB for all nodes", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify({
            items: [{ metadata: { name: "node-1" } }, { metadata: { name: "node-2" } }],
          }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({
            status: "success",
            data: {
              resultType: "vector",
              result: [
                { metric: { instance: "node-1:9100" }, value: [0, "100.235"] },
                { metric: { instance: "node-2:9100" }, value: [0, "50.1"] },
              ],
            },
          }),
          errors: "",
        });

      const result = await diskFromPrometheus.resolve({ clusterId: "any-cluster" });
      expect(result).toEqual([
        { name: "node-1", freeGiB: 100.23 },
        { name: "node-2", freeGiB: 50.1 },
      ]);
    });

    it("should resolve disk for a single node when nodeName is provided", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValueOnce({
        output: JSON.stringify({
          status: "success",
          data: {
            resultType: "vector",
            result: [{ metric: { instance: "node-1:9100" }, value: [0, "123.55"] }],
          },
        }),
        errors: "",
      });

      const result = await diskFromPrometheus.resolve({
        clusterId: "any-cluster",
        nodeName: "node-1",
      });

      expect(result).toEqual({ name: "node-1", freeGiB: 123.55 });
    });

    it("should throw when no metrics are returned", async () => {
      vi.mocked(discoverPrometheus.discoverPrometheusService).mockResolvedValue({
        name: "prometheus",
        namespace: "monitoring",
        port: 9090,
      });
      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify({
            items: [{ metadata: { name: "node-1" } }],
          }),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({ status: "success", data: { result: [] } }),
          errors: "",
        });

      await expect(diskFromPrometheus.resolve({ clusterId: "any-cluster" })).rejects.toThrow(
        "Prometheus returned no disk data",
      );
    });
  });
  describe("metadata", () => {
    it("should have correct id", () => {
      expect(diskFromPrometheus.id).toBe("disk-prometheus");
    });
    it("should have correct title", () => {
      expect(diskFromPrometheus.title).toBe("Prometheus");
    });
  });
});
