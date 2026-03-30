import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { discoverNodeExporterPodForNode } from "./discover-node-exporter";
import * as kubectlProxy from "$shared/api/kubectl-proxy";
import type { PodItem, ServiceItem } from "../model/clusters";

vi.mock("@/lib/shared/api/kubectl-proxy");

describe("discoverNodeExporterPodForNode", () => {
  const mockClusterId = "test-cluster-123";
  const mockNodeName = "worker-node-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockPod = (
    name: string,
    namespace: string,
    nodeName: string,
    labels: Record<string, string> = {},
  ): PodItem => ({
    metadata: {
      name,
      namespace,
      labels,
    },
    spec: {
      nodeName,
      containers: [],
      volumes: [],
    },
    status: {
      phase: "Running",
    },
  });

  const createMockService = (
    name: string,
    namespace: string,
    port: number,
    selector: Record<string, string> = {},
    labels: Record<string, string> = {},
  ): ServiceItem => ({
    metadata: {
      name,
      namespace,
      labels,
      creationTimestamp: new Date(),
    },
    spec: {
      type: "ClusterIP",
      selector,
      ports: [
        {
          port,
          name: "metrics",
          protocol: "TCP",
          targetPort: port,
        },
      ],
    },
  });

  describe("direct pod discovery (strategy 1)", () => {
    it("should find node-exporter pod by name hint on target node", async () => {
      const pod = createMockPod("node-exporter-abc", "monitoring", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toEqual({
        namespace: "monitoring",
        podName: "node-exporter-abc",
      });

      expect(kubectlProxy.kubectlJson).toHaveBeenCalledWith("get pods -A", {
        clusterId: mockClusterId,
      });
    });

    it("should find pod by label value containing node-exporter", async () => {
      const pod = createMockPod("some-pod", "default", mockNodeName, {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toEqual({
        namespace: "default",
        podName: "some-pod",
      });
    });

    it("should find pod by label value containing prometheus-node-exporter", async () => {
      const pod = createMockPod("metrics-pod", "kube-system", mockNodeName, {
        "app.kubernetes.io/name": "prometheus-node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toEqual({
        namespace: "kube-system",
        podName: "metrics-pod",
      });
    });

    it('should prefer pod in "monitoring" namespace', async () => {
      const pod1 = createMockPod("node-exporter-1", "default", mockNodeName);
      const pod2 = createMockPod("node-exporter-2", "monitoring", mockNodeName);
      const pod3 = createMockPod("node-exporter-3", "kube-system", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod1, pod2, pod3],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-2");
      expect(result?.namespace).toBe("monitoring");
    });

    it('should prefer "kps" namespace when "monitoring" not available', async () => {
      const pod1 = createMockPod("node-exporter-1", "default", mockNodeName);
      const pod2 = createMockPod("node-exporter-2", "kps", mockNodeName);
      const pod3 = createMockPod("node-exporter-3", "kube-system", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod1, pod2, pod3],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-2");
      expect(result?.namespace).toBe("kps");
    });

    it("should use first pod when neither monitoring nor kps available", async () => {
      const pod1 = createMockPod("node-exporter-1", "default", mockNodeName);
      const pod2 = createMockPod("node-exporter-2", "kube-system", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod1, pod2],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-1");
      expect(result?.namespace).toBe("default");
    });

    it("should ignore pods on different nodes", async () => {
      const pod1 = createMockPod("node-exporter-1", "monitoring", "other-node");
      const pod2 = createMockPod("node-exporter-2", "monitoring", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod1, pod2],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-2");
    });

    it("should ignore pods without node-exporter hints", async () => {
      const pod1 = createMockPod("random-pod", "monitoring", mockNodeName);
      const pod2 = createMockPod("node-exporter-abc", "monitoring", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod1, pod2],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-abc");
    });

    it("should handle case-insensitive matching", async () => {
      const pod = createMockPod("NODE-EXPORTER-ABC", "monitoring", mockNodeName, {
        app: "Node-Exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).not.toBeNull();
    });

    it("should skip pods with empty namespace", async () => {
      const invalidPod: PodItem = {
        metadata: {
          name: "node-exporter",
          namespace: "",
        },
        spec: {
          nodeName: mockNodeName,
          containers: [],
          volumes: [],
        },
        status: { phase: "Running" },
      };

      const validPod = createMockPod("node-exporter-2", "monitoring", mockNodeName);

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [invalidPod, validPod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-2");
    });

    it("should skip pods with empty name", async () => {
      const invalidPod: PodItem = {
        metadata: {
          name: "",
          namespace: "monitoring",
        },
        spec: {
          nodeName: mockNodeName,
          containers: [],
          volumes: [],
        },
        status: { phase: "Running" },
      };

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [invalidPod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });
  });

  describe("service-based discovery (strategy 2)", () => {
    it("should find pod via service selector when direct discovery fails", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
      });

      const pod = createMockPod("node-exporter-xyz", "monitoring", mockNodeName, {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] }) // No direct pods
        .mockResolvedValueOnce({ items: [service] }) // Services
        .mockResolvedValueOnce({ items: [pod] }); // Pods by selector

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toEqual({
        namespace: "monitoring",
        podName: "node-exporter-xyz",
      });

      expect(kubectlProxy.kubectlJson).toHaveBeenCalledWith(
        "get pods -n monitoring -l app=node-exporter",
        { clusterId: mockClusterId },
      );
    });

    it("should only use services with port 9100", async () => {
      const wrongPortSvc = createMockService("metrics", "monitoring", 8080);
      const correctSvc = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
      });

      const pod = createMockPod("node-exporter-xyz", "monitoring", mockNodeName, {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [wrongPortSvc, correctSvc] })
        .mockResolvedValueOnce({ items: [pod] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).not.toBeNull();
      expect(kubectlProxy.kubectlJson).toHaveBeenCalledWith(
        "get pods -n monitoring -l app=node-exporter",
        { clusterId: mockClusterId },
      );
    });

    it("should handle multiple selector labels", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
        component: "metrics",
      });

      const pod = createMockPod("node-exporter-xyz", "monitoring", mockNodeName, {
        app: "node-exporter",
        component: "metrics",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] })
        .mockResolvedValueOnce({ items: [pod] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).not.toBeNull();
      expect(kubectlProxy.kubectlJson).toHaveBeenCalledWith(
        expect.stringMatching(
          /get pods -n monitoring -l .*(app=node-exporter|component=metrics).*/,
        ),
        { clusterId: mockClusterId },
      );
    });

    it("should return null when service has no selector", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100);

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when service has empty selector", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {});

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should find pod on target node from selector results", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
      });

      const pod1 = createMockPod("node-exporter-1", "monitoring", "other-node", {
        app: "node-exporter",
      });
      const pod2 = createMockPod("node-exporter-2", "monitoring", mockNodeName, {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] })
        .mockResolvedValueOnce({ items: [pod1, pod2] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result?.podName).toBe("node-exporter-2");
    });

    it("should return null when no pod on target node", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
      });

      const pod = createMockPod("node-exporter-1", "monitoring", "other-node", {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] })
        .mockResolvedValueOnce({ items: [pod] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when service namespace is empty", async () => {
      const invalidService: ServiceItem = {
        metadata: {
          name: "node-exporter",
          namespace: "",
          creationTimestamp: new Date(),
        },
        spec: {
          type: "ClusterIP",
          selector: { app: "node-exporter" },
          ports: [{ port: 9100, name: "metrics", protocol: "TCP", targetPort: 9100 }],
        },
      };

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [invalidService] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should skip pods with empty namespace from selector results", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
      });

      const invalidPod: PodItem = {
        metadata: {
          name: "node-exporter",
          namespace: "",
        },
        spec: {
          nodeName: mockNodeName,
          containers: [],
          volumes: [],
        },
        status: { phase: "Running" },
      };

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] })
        .mockResolvedValueOnce({ items: [invalidPod] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should return null when kubectlJson returns string (error)", async () => {
      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue("Error: connection failed");

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when pods response is string", async () => {
      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce("Error: pods not found")
        .mockResolvedValueOnce({ items: [] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when services response is string", async () => {
      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce("Error: services not found");

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when selector pods response is string", async () => {
      const service = createMockService("node-exporter", "monitoring", 9100, {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] })
        .mockResolvedValueOnce("Error: pods not found");

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should handle missing items in response", async () => {
      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({});

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should handle null items in response", async () => {
      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({ items: null });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });

    it("should return null when no services found", async () => {
      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toBeNull();
    });
  });

  describe("metadata validation", () => {
    it("should handle pod with undefined labels", async () => {
      const pod: PodItem = {
        metadata: {
          name: "node-exporter",
          namespace: "monitoring",
        },
        spec: {
          nodeName: mockNodeName,
          containers: [],
          volumes: [],
        },
        status: { phase: "Running" },
      };

      vi.mocked(kubectlProxy.kubectlJson).mockResolvedValue({
        items: [pod],
      });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).toEqual({
        namespace: "monitoring",
        podName: "node-exporter",
      });
    });

    it("should handle service with undefined labels", async () => {
      const service: ServiceItem = {
        metadata: {
          name: "node-exporter",
          namespace: "monitoring",
          creationTimestamp: new Date(),
        },
        spec: {
          type: "ClusterIP",
          selector: { app: "node-exporter" },
          ports: [{ port: 9100, name: "metrics", protocol: "TCP", targetPort: 9100 }],
        },
      };

      const pod = createMockPod("node-exporter-xyz", "monitoring", mockNodeName, {
        app: "node-exporter",
      });

      vi.mocked(kubectlProxy.kubectlJson)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [service] })
        .mockResolvedValueOnce({ items: [pod] });

      const result = await discoverNodeExporterPodForNode(mockClusterId, mockNodeName);

      expect(result).not.toBeNull();
    });
  });
});
