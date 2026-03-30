import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNodeAvailableDiskSpace } from "./node-disk-space";
import * as tauriHttp from "@tauri-apps/plugin-http";
import * as portForward from "$shared/api/port-forward";
import * as discoverNodeExporter from "$shared/api/discover-node-exporter";
import * as kubectlProxy from "$shared/api/kubectl-proxy";

vi.mock("@tauri-apps/plugin-http");
vi.mock("@/lib/shared/api/port-forward");
vi.mock("@/lib/shared/api/discover-node-exporter");
vi.mock("@/lib/shared/api/kubectl-proxy");

describe("getNodeAvailableDiskSpace", () => {
  const mockClusterId = "test-cluster-123";
  const mockNodeName = "worker-node-1";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const createNodeExporterMetrics = (
    device: string,
    fstype: string,
    mountpoint: string,
    availableBytes: number,
  ): string => {
    return `# HELP node_filesystem_avail_bytes Filesystem space available to non-root users in bytes.
# TYPE node_filesystem_avail_bytes gauge
node_filesystem_avail_bytes{device="${device}",fstype="${fstype}",mountpoint="${mountpoint}"} ${availableBytes}
node_filesystem_avail_bytes{device="/dev/sdb1",fstype="ext4",mountpoint="/data"} 5368709120
`;
  };

  describe("node-exporter resolution (primary)", () => {
    it("should return disk info from node-exporter when available", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-abc",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      const metricsText = createNodeExporterMetrics("/dev/sda1", "ext4", "/", 107374182400);

      const mockResponse = {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(metricsText),
      } as unknown as Response;

      vi.mocked(tauriHttp.fetch).mockResolvedValue(mockResponse);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;

      expect(result).toEqual({
        mountpoint: "/",
        device: "/dev/sda1",
        fstype: "ext4",
        availableBytes: 107374182400,
        availableGiB: 100,
        success: true,
      });

      expect(portForward.startPortForward).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: "monitoring",
          resource: "pod/node-exporter-abc",
          remotePort: 9100,
          clusterId: mockClusterId,
        }),
      );
      expect(portForward.stopPortForward).toHaveBeenCalled();
    });

    it("should match exact mountpoint when filter is provided", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      const metricsText = `node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 50000000000
node_filesystem_avail_bytes{device="/dev/sdb1",fstype="ext4",mountpoint="/data"} 100000000000`;

      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(metricsText),
      } as unknown as Response;

      vi.mocked(tauriHttp.fetch).mockResolvedValue(mockResponse);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName, "/data");

      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;

      expect(result.mountpoint).toBe("/data");
      expect(result.availableBytes).toBe(100000000000);
      expect(result.availableGiB).toBe(93.13);
    });

    it("should fallback to first mountpoint when exact match not found", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      const metricsText = createNodeExporterMetrics("/dev/sda1", "ext4", "/boot", 10737418240);

      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(metricsText),
      } as unknown as Response;

      vi.mocked(tauriHttp.fetch).mockResolvedValue(mockResponse);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName, "/");

      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;

      expect(result.mountpoint).toBe("/boot");
      expect(result.availableGiB).toBe(10);
    });

    it("should return error when node_filesystem_avail_bytes not found", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      const metricsText = "# No filesystem metrics available";

      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(metricsText),
      } as unknown as Response;

      vi.mocked(tauriHttp.fetch).mockResolvedValue(mockResponse);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("node_filesystem_avail_bytes not found");
      expect(result.availableGiB).toBe(0);
    });

    it("should fallback to kubelet when port-forward fails to start", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({
        success: false,
        error: "Port already in use",
      });

      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: 53687091200,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.success).toBe(true);
      expect(result.availableGiB).toBe(50);
      expect(result.error).toBe("From kubelet summary (node.fs)");
    });

    it("should fallback to kubelet when HTTP endpoint not ready", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });
      vi.mocked(tauriHttp.fetch).mockRejectedValue(new Error("Connection refused"));
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: 32212254720,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      for (let i = 0; i < 14; i++) {
        await vi.advanceTimersByTimeAsync(250);
      }

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.availableGiB).toBe(30);
      expect(portForward.stopPortForward).toHaveBeenCalled();
    });
  });

  describe("kubelet summary resolution (fallback)", () => {
    beforeEach(() => {
      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(null);
    });

    it("should return disk info from kubelet summary when node-exporter unavailable", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: 107374182400,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result).toEqual({
        mountpoint: "/",
        device: "",
        fstype: "",
        availableBytes: 107374182400,
        availableGiB: 100,
        success: true,
        error: "From kubelet summary (node.fs)",
      });

      expect(kubectlProxy.kubectlRawFront).toHaveBeenCalledWith(
        `get --raw /api/v1/nodes/${mockNodeName}/proxy/stats/summary`,
        { clusterId: mockClusterId },
      );
    });

    it("should handle fs.available.bytes structure", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            available: {
              bytes: 53687091200,
            },
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.availableGiB).toBe(50);
    });

    it("should handle fs.available_bytes structure", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            available_bytes: 32212254720,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.availableGiB).toBe(30);
    });

    it("should handle fs.availableByte structure", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            availableByte: 21474836480,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.availableGiB).toBe(20);
    });

    it("should prioritize availableBytes field", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: 10737418240,
            available: {
              bytes: 5368709120,
            },
            available_bytes: 2147483648,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.availableGiB).toBe(10);
    });

    it("should return N/A when kubelet summary fails", async () => {
      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: "",
        errors: "Connection timeout",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toBe("N/A");
      expect(result.availableGiB).toBe(0);
    });

    it("should return N/A when fs data is missing", async () => {
      const kubeletSummary = {
        node: {},
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toBe("N/A");
    });

    it("should handle non-numeric available bytes", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: "invalid",
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
      expect(result.error).toBe("N/A");
    });

    it("should handle Infinity in available bytes", async () => {
      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: Infinity,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      expect(result.success).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle custom mountpoint filter", async () => {
      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(null);

      const kubeletSummary = {
        node: {
          fs: {
            availableBytes: 10737418240,
          },
        },
      };

      vi.mocked(kubectlProxy.kubectlRawFront).mockResolvedValue({
        output: JSON.stringify(kubeletSummary),
        errors: "",
      });

      const result = await getNodeAvailableDiskSpace(mockClusterId, mockNodeName, "/custom/mount");

      expect(result.mountpoint).toBe("/custom/mount");
    });

    it("should handle malformed metrics lines and fallback to kubelet", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      const metricsText = `node_filesystem_avail_bytes{incomplete
node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4"} 100000
node_filesystem_avail_bytes{device="/dev/sdb1",fstype="ext4",mountpoint="/"} invalid_number`;

      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(metricsText),
      } as unknown as Response;

      vi.mocked(tauriHttp.fetch).mockResolvedValue(mockResponse);
      vi.mocked(portForward.stopPortForward).mockResolvedValue(undefined);

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.availableGiB).toBe(0);
      expect(result.error).toContain("node_filesystem_avail_bytes not found");
    });

    it("should handle stopPortForward failure gracefully", async () => {
      const nodeExporterPod = {
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      };

      vi.mocked(discoverNodeExporter.discoverNodeExporterPodForNode).mockResolvedValue(
        nodeExporterPod,
      );
      vi.mocked(portForward.startPortForward).mockResolvedValue({ success: true });

      const metricsText = createNodeExporterMetrics("/dev/sda1", "ext4", "/", 10737418240);

      const mockResponse = {
        ok: true,
        text: vi.fn().mockResolvedValue(metricsText),
      } as unknown as Response;

      vi.mocked(tauriHttp.fetch).mockResolvedValue(mockResponse);
      vi.mocked(portForward.stopPortForward).mockRejectedValue(
        new Error("Failed to stop port-forward"),
      );

      const promise = getNodeAvailableDiskSpace(mockClusterId, mockNodeName);

      await vi.advanceTimersByTimeAsync(250);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.availableGiB).toBe(10);
    });
  });
});
