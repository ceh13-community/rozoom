import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricsServerResolver } from "./cpu-mem.metrics-server";
import * as kubectlProxy from "$shared/api/kubectl-proxy";

vi.mock("@/lib/shared/api/kubectl-proxy");

describe("MetricsServerResolver", () => {
  const mockClusterId = "test-cluster-123";
  const mockNodeName = "worker-node-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("metadata", () => {
    it("should have correct name", () => {
      expect(MetricsServerResolver.name).toBe("metrics-server");
    });
  });

  describe("isAvailable", () => {
    it("should return true when metrics-server is available", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output:
          "NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%\nnode-1         500m         25%    2048Mi          50%",
        errors: "",
      });

      const result = await MetricsServerResolver.isAvailable(mockClusterId);

      expect(result).toBe(true);
      expect(kubectlProxy.kubectlRawFront).toHaveBeenCalledWith("top nodes", {
        clusterId: mockClusterId,
      });
    });

    it("should return false when kubectl top nodes throws error", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockRejectedValue(
        new Error("metrics-server not available"),
      );

      const result = await MetricsServerResolver.isAvailable(mockClusterId);

      expect(result).toBe(false);
    });

    it("should return false when kubectl returns error", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockRejectedValue(
        new Error("Metrics API not available"),
      );

      const result = await MetricsServerResolver.isAvailable(mockClusterId);

      expect(result).toBe(false);
    });
  });

  describe("resolve", () => {
    it("should parse CPU and memory percentages from kubectl top output", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-1  500m         25%    2048Mi          50%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result).toEqual({
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: 25,
          memoryPercent: 50,
        },
      });

      expect(kubectlProxy.kubectlRawFront).toHaveBeenCalledWith(`top node ${mockNodeName}`, {
        clusterId: mockClusterId,
      });
    });

    it("should handle different spacing in output", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-1    1000m     50%      4096Mi      75%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result).toEqual({
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: 50,
          memoryPercent: 75,
        },
      });
    });

    it("should handle single-digit percentages", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-1  100m         5%     512Mi           8%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result).toEqual({
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: 5,
          memoryPercent: 8,
        },
      });
    });

    it("should handle 100% usage", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-1  2000m        100%   8192Mi          100%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result).toEqual({
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: 100,
          memoryPercent: 100,
        },
      });
    });

    it("should handle 0% usage", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-1  0m           0%     128Mi           0%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result).toEqual({
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: 0,
          memoryPercent: 0,
        },
      });
    });

    it("should return error when no metrics line exists", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No metrics line");
    });

    it("should return error when output is empty", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error when kubectl command fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockRejectedValue(new Error("Node not found"));

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Node not found");
    });

    it("should handle extra whitespace in lines", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
  worker-node-1    500m       25%      2048Mi        50%  `;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result).toEqual({
        success: true,
        source: "metrics-server",
        value: {
          cpuPercent: 25,
          memoryPercent: 50,
        },
      });
    });

    it("should parse percentages without % symbol correctly", async () => {
      const mockOutput = `NAME           CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-1  500m         25%    2048Mi          50%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result.value?.cpuPercent).toBe(25);
      expect(result.value?.memoryPercent).toBe(50);
    });

    it("should handle node names with hyphens and numbers", async () => {
      const nodeName = "worker-node-123-abc";
      const mockOutput = `NAME                 CPU(cores)   CPU%   MEMORY(bytes)   MEMORY%
worker-node-123-abc  500m         30%    2048Mi          60%`;

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: mockOutput,
        errors: "",
      });

      const result = await MetricsServerResolver.resolve(mockClusterId, nodeName);

      expect(result.success).toBe(true);
      expect(result.value).toEqual({
        cpuPercent: 30,
        memoryPercent: 60,
      });
    });

    it("should return error with string representation of error", async () => {
      const errorMessage = "Connection timeout";
      vi.mocked(kubectlProxy.kubectlRawFront).mockRejectedValue(new Error(errorMessage));

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toBe(`Error: ${errorMessage}`);
    });

    it("should handle non-Error exceptions", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockRejectedValue("String error");

      const result = await MetricsServerResolver.resolve(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toBe("String error");
    });
  });
});
