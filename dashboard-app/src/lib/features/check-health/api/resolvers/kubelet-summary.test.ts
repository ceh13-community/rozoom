import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getKubeletSummaryForNode,
  extractDiskFreeGiB,
  extractDiskPercent,
} from "./kubelet-summary";
import * as kubectlProxy from "$shared/api/kubectl-proxy";

vi.mock("@/lib/shared/api/kubectl-proxy");

describe("kubelet-summary", () => {
  const mockClusterId = "test-cluster-123";
  const mockNodeName = "worker-node-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getKubeletSummaryForNode", () => {
    it("should fetch and parse kubelet summary for a node", async () => {
      const mockSummary = {
        node: {
          nodeName: "worker-node-1",
          cpu: { usageNanoCores: 2000000000 },
          memory: { workingSetBytes: 4294967296 },
          fs: { availableBytes: 107374182400 },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(mockSummary),
        errors: "",
      });

      const result = await getKubeletSummaryForNode(mockClusterId, mockNodeName);

      expect(result).toEqual(mockSummary);
      expect(kubectlProxy.kubectlRawFront).toHaveBeenCalledWith(
        `get --raw /api/v1/nodes/${mockNodeName}/proxy/stats/summary`,
        { clusterId: mockClusterId },
      );
    });

    it("should handle minimal summary response", async () => {
      const mockSummary = {
        node: {},
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(mockSummary),
        errors: "",
      });

      const result = await getKubeletSummaryForNode(mockClusterId, mockNodeName);

      expect(result).toEqual(mockSummary);
    });

    it("should handle empty summary response", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({}),
        errors: "",
      });

      const result = await getKubeletSummaryForNode(mockClusterId, mockNodeName);

      expect(result).toEqual({});
    });

    it("should throw on invalid JSON", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "invalid json {",
        errors: "",
      });

      await expect(getKubeletSummaryForNode(mockClusterId, mockNodeName)).rejects.toThrow();
    });
  });

  describe("extractDiskFreeGiB", () => {
    it("should extract disk free space from node.fs", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 107374182400,
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBe(100);
    });

    it("should convert bytes to GiB correctly", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 53687091200,
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBe(50);
    });

    it("should handle fractional GiB values", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 1610612736,
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBeCloseTo(1.5, 2);
    });

    it("should fallback to runtime.imageFs when node.fs is missing", async () => {
      const summary = {
        node: {
          runtime: {
            imageFs: {
              availableBytes: 32212254720,
            },
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBe(30);
    });

    it("should prioritize node.fs over runtime.imageFs", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 107374182400,
          },
          runtime: {
            imageFs: {
              availableBytes: 53687091200,
            },
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBe(100);
    });

    it("should return null when availableBytes is missing", async () => {
      const summary = {
        node: {
          fs: {},
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBeNull();
    });

    it("should return null when fs is missing", async () => {
      const summary = {
        node: {},
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBeNull();
    });

    it("should return null when node is missing", async () => {
      const summary = {};

      const result = extractDiskFreeGiB(summary);

      expect(result).toBeNull();
    });

    it("should return null when availableBytes is not a number", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: "invalid" as unknown as number,
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBeNull();
    });

    it("should handle zero availableBytes", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 0,
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBe(0);
    });

    it("should handle very large values", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 1099511627776,
          },
        },
      };

      const result = extractDiskFreeGiB(summary);

      expect(result).toBe(1024);
    });
  });

  describe("extractDiskPercent", () => {
    it("should calculate disk usage percentage from node.fs", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 107374182400,
            usedBytes: 53687091200,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("50%");
    });

    it("should round percentage to nearest integer", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 33,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("33%");
    });

    it("should cap percentage at 100%", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 150,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("100%");
    });

    it("should floor percentage at 0%", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: -10,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("0%");
    });

    it("should return 0% when capacity is zero", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 0,
            usedBytes: 100,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("0%");
    });

    it("should return 0% when capacity is negative", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: -100,
            usedBytes: 50,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("0%");
    });

    it("should fallback to runtime.imageFs when node.fs is missing", async () => {
      const summary = {
        node: {
          runtime: {
            imageFs: {
              capacityBytes: 107374182400,
              usedBytes: 32212254720,
            },
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("30%");
    });

    it("should prioritize node.fs over runtime.imageFs", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 50,
          },
          runtime: {
            imageFs: {
              capacityBytes: 100,
              usedBytes: 75,
            },
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("50%");
    });

    it("should return null when capacityBytes is missing", async () => {
      const summary = {
        node: {
          fs: {
            usedBytes: 50,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should return null when usedBytes is missing", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should return null when both capacityBytes and usedBytes are missing", async () => {
      const summary = {
        node: {
          fs: {},
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should return null when fs is missing", async () => {
      const summary = {
        node: {},
      };

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should return null when node is missing", async () => {
      const summary = {};

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should return null when capacityBytes is not a number", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: "invalid" as unknown as number,
            usedBytes: 50,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should return null when usedBytes is not a number", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: "invalid" as unknown as number,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBeNull();
    });

    it("should handle zero usedBytes", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 0,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("0%");
    });

    it("should handle 100% usage", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 100,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("100%");
    });

    it("should handle rounding up", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 66.5,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("67%");
    });

    it("should handle rounding down", async () => {
      const summary = {
        node: {
          fs: {
            capacityBytes: 100,
            usedBytes: 66.4,
          },
        },
      };

      const result = extractDiskPercent(summary);

      expect(result).toBe("66%");
    });
  });
});
