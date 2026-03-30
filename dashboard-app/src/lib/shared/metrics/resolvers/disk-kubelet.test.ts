import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { diskFromKubeletSummary } from "./disk.kubelet";
import * as kubectlProxy from "$shared/api/kubectl-proxy";

vi.mock("@/lib/shared/api/kubectl-proxy");

describe("diskFromKubeletSummary", () => {
  const mockClusterId = "test-cluster-123";
  const mockNodeName = "worker-node-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createSummary = (availableBytes: number) => ({
    node: {
      fs: {
        availableBytes,
      },
    },
  });

  describe("successful disk retrieval", () => {
    it("should return disk free space from fs.availableBytes", async () => {
      const summary = createSummary(107374182400); // 100 GiB

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toEqual({
        name: mockNodeName,
        freeGiB: 100,
      });

      expect(kubectlProxy.kubectlRawFront).toHaveBeenCalledWith(
        `get --raw /api/v1/nodes/${mockNodeName}/proxy/stats/summary`,
        { clusterId: mockClusterId },
      );
    });

    it("should convert bytes to GiB with 2 decimal places", async () => {
      const summary = createSummary(1610612736); // 1.5 GiB

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(1.5);
    });

    it("should handle zero available bytes", async () => {
      const summary = createSummary(0);

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toEqual({
        name: mockNodeName,
        freeGiB: 0,
      });
    });

    it("should handle very large values", async () => {
      const summary = createSummary(1099511627776); // 1 TiB

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(1024);
    });

    it("should round to 2 decimal places", async () => {
      const summary = createSummary(1073741824 + 536870912); // 1.5 GiB

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(1.5);
    });
  });

  describe("alternative fs structures", () => {
    it("should fallback to fs.available.bytes", async () => {
      const summary = {
        node: {
          fs: {
            available: {
              bytes: 53687091200, // 50 GiB
            },
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(50);
    });

    it("should fallback to fs.available as number", async () => {
      const summary = {
        node: {
          fs: {
            available: 32212254720, // 30 GiB
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(30);
    });

    it("should fallback to fs.available_bytes", async () => {
      const summary = {
        node: {
          fs: {
            available_bytes: 21474836480, // 20 GiB
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(20);
    });

    it("should prioritize availableBytes over other fields", async () => {
      const summary = {
        node: {
          fs: {
            availableBytes: 10737418240, // 10 GiB
            available: {
              bytes: 5368709120, // 5 GiB (should be ignored)
            },
            available_bytes: 2147483648, // 2 GiB (should be ignored)
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(10);
    });

    it("should try available.bytes before available as number", async () => {
      const summary = {
        node: {
          fs: {
            available: {
              bytes: 10737418240, // 10 GiB
              other: 5368709120,
            },
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(10);
    });
  });

  describe("error handling", () => {
    it("should return null when kubectl returns errors", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Connection failed",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when summary has no node object", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({}),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when node has no fs object", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({ node: {} }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when fs has no available bytes fields", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({
          node: {
            fs: {
              capacityBytes: 100000000,
            },
          },
        }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when summary is not an object", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify("not an object"),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when summary is null", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(null),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when node is not an object", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({ node: "not an object" }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when fs is not an object", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({
          node: {
            fs: "not an object",
          },
        }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when availableBytes is not a number", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({
          node: {
            fs: {
              availableBytes: "not a number",
            },
          },
        }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when availableBytes is Infinity", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({
          node: {
            fs: {
              availableBytes: Infinity,
            },
          },
        }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when availableBytes is NaN", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({
          node: {
            fs: {
              availableBytes: NaN,
            },
          },
        }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when available is not an object or number", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify({
          node: {
            fs: {
              available: "invalid",
            },
          },
        }),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should throw on invalid JSON", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "invalid json {",
        errors: "",
      });

      await expect(diskFromKubeletSummary(mockClusterId, mockNodeName)).rejects.toThrow();
    });
  });

  describe("edge cases", () => {
    it("should handle negative values by returning them", async () => {
      const summary = createSummary(-1000);

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBeLessThanOrEqual(0);
    });

    it("should handle very small positive values", async () => {
      const summary = createSummary(1024); // 0.00 GiB

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBe(0);
    });

    it("should handle fractional bytes", async () => {
      const summary = createSummary(1073741824.5); // 1.0 GiB with fraction

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result?.freeGiB).toBeCloseTo(1.0, 2);
    });

    it("should preserve node name in result", async () => {
      const nodeName = "custom-node-name-123";
      const summary = createSummary(10737418240);

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, nodeName);

      expect(result?.name).toBe(nodeName);
    });

    it("should handle empty error string as success", async () => {
      const summary = createSummary(10737418240);

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(summary),
        errors: "",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).not.toBeNull();
      expect(result?.freeGiB).toBe(10);
    });

    it("should handle non-empty error string as failure", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(createSummary(10737418240)),
        errors: "some error",
      });

      const result = await diskFromKubeletSummary(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });
  });
});
