import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBytes, cpuMemFromKubeletSummary } from "./cpu-mem.kubelet";
import * as kubectlProxy from "$shared/api/kubectl-proxy";
import type { Nodes } from "$shared/model/clusters";

vi.mock("@/lib/shared/api/kubectl-proxy");

describe("cpu-mem.kubelet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseBytes", () => {
    it("should parse bytes with Ki unit", () => {
      expect(parseBytes("100Ki")).toBe(100 * 1024);
    });

    it("should parse bytes with Mi unit", () => {
      expect(parseBytes("100Mi")).toBe(100 * 1024 * 1024);
    });

    it("should parse bytes with Gi unit", () => {
      expect(parseBytes("10Gi")).toBe(10 * 1024 * 1024 * 1024);
    });

    it("should parse bytes with Ti unit", () => {
      expect(parseBytes("1Ti")).toBe(1 * 1024 * 1024 * 1024 * 1024);
    });

    it("should parse decimal values", () => {
      expect(parseBytes("1.5Gi")).toBe(1.5 * 1024 * 1024 * 1024);
    });

    it("should parse plain number without unit", () => {
      expect(parseBytes("1024")).toBe(1024);
    });

    it("should parse decimal without unit", () => {
      expect(parseBytes("1024.5")).toBe(1024.5);
    });

    it("should return 0 for empty string", () => {
      expect(parseBytes("")).toBe(0);
    });

    it("should return 0 for undefined", () => {
      expect(parseBytes(undefined)).toBe(0);
    });

    it("should return 0 for whitespace", () => {
      expect(parseBytes("   ")).toBe(0);
    });

    it("should trim whitespace", () => {
      expect(parseBytes("  100Mi  ")).toBe(100 * 1024 * 1024);
    });

    it("should return 0 for invalid format", () => {
      expect(parseBytes("invalid")).toBe(0);
    });

    it("should return 0 for non-finite values", () => {
      expect(parseBytes("NaN")).toBe(0);
      expect(parseBytes("Infinity")).toBe(0);
    });

    it("should handle zero values", () => {
      expect(parseBytes("0")).toBe(0);
      expect(parseBytes("0Mi")).toBe(0);
    });

    it("should handle very large values", () => {
      expect(parseBytes("1000Ti")).toBe(1000 * 1024 ** 4);
    });

    it("should fallback to parseFloat for non-matching patterns", () => {
      expect(parseBytes("123.45")).toBe(123.45);
    });
  });

  describe("cpuMemFromKubeletSummary", () => {
    const mockClusterId = "test-cluster-123";

    const createMockNodes = (
      nodes: Array<{
        name: string;
        cpuAllocatable: string;
        memoryAllocatable: string;
      }>,
    ): Nodes => ({
      items: nodes.map((node) => ({
        metadata: {
          name: node.name,
          namespace: "",
          creationTimestamp: "2024-01-01T00:00:00Z",
        },
        spec: {
          podCIDR: "",
          podCIDRs: [],
          providerID: "",
          taints: [],
          unschedulable: false,
          externalID: "",
          configSource: {
            configMap: {
              kubeletConfigKey: "",
              name: "",
              namespace: "",
              resourceVersion: "",
              uid: "",
            },
          },
        },
        status: {
          allocatable: {
            cpu: node.cpuAllocatable,
            memory: node.memoryAllocatable,
            "ephemeral-storage": "100Gi",
          },
        },
      })),
    });

    const createMockSummary = (cpuNanoCores: number, memoryBytes: number) => ({
      node: {
        cpu: { usageNanoCores: cpuNanoCores },
        memory: { workingSetBytes: memoryBytes },
      },
    });

    it("should return CPU and memory percentages for all nodes", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
        { name: "node-2", cpuAllocatable: "2", memoryAllocatable: "4Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(2_000_000_000, 4 * 1024 ** 3)),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(1_000_000_000, 2 * 1024 ** 3)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result).toEqual([
        { name: "node-1", cpuPct: 50, memPct: 50 },
        { name: "node-2", cpuPct: 50, memPct: 50 },
      ]);
    });

    it("should handle CPU in millicores", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "2000m", memoryAllocatable: "4Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(1_000_000_000, 2 * 1024 ** 3)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result).toEqual([{ name: "node-1", cpuPct: 50, memPct: 50 }]);
    });

    it("should round percentages to nearest integer", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "3", memoryAllocatable: "3Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(
            createMockSummary(1_000_000_000, 1 * 1024 ** 3), // 33.33% CPU, 33.33% Memory
          ),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(33);
      expect(result[0].memPct).toBe(33);
    });

    it("should cap percentages at 100", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "1", memoryAllocatable: "1Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(
            createMockSummary(5_000_000_000, 5 * 1024 ** 3), // Over 100%
          ),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(100);
      expect(result[0].memPct).toBe(100);
    });

    it("should return 0 when allocatable resources are zero", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "0", memoryAllocatable: "0" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(1_000_000_000, 1024 ** 3)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(0);
      expect(result[0].memPct).toBe(0);
    });

    it("should handle missing CPU usage", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({
            node: {
              memory: { workingSetBytes: 4 * 1024 ** 3 },
            },
          }),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(0);
      expect(result[0].memPct).toBe(50);
    });

    it("should handle missing memory usage", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({
            node: {
              cpu: { usageNanoCores: 2_000_000_000 },
            },
          }),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(50);
      expect(result[0].memPct).toBe(0);
    });

    it("should handle missing node object in summary", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify({}),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(0);
      expect(result[0].memPct).toBe(0);
    });

    it("should handle missing allocatable data", async () => {
      const mockNodes: Nodes = {
        items: [
          {
            metadata: {
              name: "node-1",
              namespace: "",
              creationTimestamp: "2024-01-01T00:00:00Z",
            },
            spec: {
              podCIDR: "",
              podCIDRs: [],
              providerID: "",
              taints: [],
              unschedulable: false,
              externalID: "",
              configSource: {
                configMap: {
                  kubeletConfigKey: "",
                  name: "",
                  namespace: "",
                  resourceVersion: "",
                  uid: "",
                },
              },
            },
            status: {}, // No allocatable
          },
        ],
      };

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(2_000_000_000, 4 * 1024 ** 3)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(0);
      expect(result[0].memPct).toBe(0);
    });

    it("should throw error when getting nodes fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Failed to get nodes",
      });

      await expect(cpuMemFromKubeletSummary(mockClusterId)).rejects.toThrow("Failed to get nodes");
    });

    it("should throw error when getting summary fails", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: "",
          errors: "Summary endpoint unavailable",
        });

      await expect(cpuMemFromKubeletSummary(mockClusterId)).rejects.toThrow(
        "Summary endpoint unavailable",
      );
    });

    it("should handle empty nodes list", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({ items: [] }),
        errors: "",
      });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result).toEqual([]);
    });

    it("should handle non-array items", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({ items: null }),
        errors: "",
      });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result).toEqual([]);
    });

    it("should handle missing items field", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({}),
        errors: "",
      });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result).toEqual([]);
    });

    it("should process multiple nodes in parallel", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
        { name: "node-2", cpuAllocatable: "2", memoryAllocatable: "4Gi" },
        { name: "node-3", cpuAllocatable: "8", memoryAllocatable: "16Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(2_000_000_000, 4 * 1024 ** 3)),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(1_000_000_000, 2 * 1024 ** 3)),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(4_000_000_000, 8 * 1024 ** 3)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: "node-1", cpuPct: 50, memPct: 50 });
      expect(result[1]).toEqual({ name: "node-2", cpuPct: 50, memPct: 50 });
      expect(result[2]).toEqual({ name: "node-3", cpuPct: 50, memPct: 50 });
    });

    it("should handle zero usage values", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(0, 0)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].cpuPct).toBe(0);
      expect(result[0].memPct).toBe(0);
    });

    it("should handle different memory units", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8192Mi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: JSON.stringify(createMockSummary(2_000_000_000, 4 * 1024 ** 3)),
          errors: "",
        });

      const result = await cpuMemFromKubeletSummary(mockClusterId);

      expect(result[0].memPct).toBe(50);
    });

    it("should throw on invalid JSON in nodes response", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "invalid json {",
        errors: "",
      });

      await expect(cpuMemFromKubeletSummary(mockClusterId)).rejects.toThrow();
    });

    it("should throw on invalid JSON in summary response", async () => {
      const mockNodes = createMockNodes([
        { name: "node-1", cpuAllocatable: "4", memoryAllocatable: "8Gi" },
      ]);

      vi.mocked(kubectlProxy.kubectlRawFront)
        .mockResolvedValueOnce({
          output: JSON.stringify(mockNodes),
          errors: "",
        })
        .mockResolvedValueOnce({
          output: "invalid json {",
          errors: "",
        });

      await expect(cpuMemFromKubeletSummary(mockClusterId)).rejects.toThrow();
    });
  });
});
