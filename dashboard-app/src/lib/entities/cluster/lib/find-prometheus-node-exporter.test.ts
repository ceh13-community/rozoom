import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findPrometheusNodeExporter } from "./find-prometheus-node-exporter";
import * as tauriApi from "$shared/api/tauri";
import * as logPlugin from "@tauri-apps/plugin-log";
import type { PodItem, DaemonSets, DaemonSetItem } from "$shared/model/clusters";

vi.mock("@tauri-apps/plugin-log");
vi.mock("@/lib/shared/api/tauri");

describe("findPrometheusNodeExporter", () => {
  const mockClusterId = "test-cluster-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockPod = (
    name: string,
    namespace: string,
    ownerKind: string,
    ownerName: string,
  ): PodItem => ({
    metadata: {
      name,
      namespace,
      ownerReferences: [
        {
          kind: ownerKind,
          name: ownerName,
        },
      ],
    },
    spec: {
      containers: [
        {
          name: "container",
          image: "image:latest",
          resources: {
            limits: { cpu: "100m", memory: "128Mi" },
            requests: { cpu: "50m", memory: "64Mi" },
          },
        },
      ],
      nodeName: "node-1",
      volumes: [],
    },
    status: {
      phase: "Running",
      containerStatuses: [
        {
          name: "container",
          ready: true,
          restartCount: 0,
          state: {
            running: {
              startedAt: "2024-01-01T00:00:00Z",
            },
          },
        },
      ],
    },
  });

  const createMockDaemonSet = (
    name: string,
    namespace: string,
    labels: Record<string, string>,
  ): DaemonSetItem => ({
    metadata: {
      name,
      namespace,
      labels,
    },
    spec: {
      selector: {
        matchLabels: {},
      },
      template: {
        metadata: {
          labels: {},
        },
        spec: {
          containers: [],
          nodeSelector: {},
        },
      },
    },
    status: {
      currentNumberScheduled: 3,
      numberReady: 3,
      desiredNumberScheduled: 3,
      numberUnavailable: 0,
      numberAvailable: 3,
    },
  });

  describe('when DaemonSet is found with "app.kubernetes.io/name" label', () => {
    it("should return pods belonging to the node-exporter DaemonSet", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "monitoring", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("node-exporter-1", "monitoring", "DaemonSet", "node-exporter-ds"),
        createMockPod("node-exporter-2", "monitoring", "DaemonSet", "node-exporter-ds"),
        createMockPod("other-pod", "monitoring", "Deployment", "other-deployment"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(2);
      expect(result[0].metadata.name).toBe("node-exporter-1");
      expect(result[1].metadata.name).toBe("node-exporter-2");
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledWith(mockClusterId, "all");
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(1);
    });

    it('should return pods when label contains "prometheus-node-exporter"', async () => {
      const daemonSet = createMockDaemonSet("prom-node-exp", "default", {
        "app.kubernetes.io/name": "prometheus-node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("prom-pod-1", "default", "DaemonSet", "prom-node-exp"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("prom-pod-1");
    });
  });

  describe('when DaemonSet is found with "app" label', () => {
    it('should try "app" label after "app.kubernetes.io/name" fails', async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "kube-system", {
        app: "node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("node-exporter-abc", "kube-system", "DaemonSet", "node-exporter-ds"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets)
        .mockResolvedValueOnce({ items: [] }) // First call with "app.kubernetes.io/name"
        .mockResolvedValueOnce({ items: [daemonSet] }); // Second call with "app"
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("node-exporter-abc");
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(2);
    });
  });

  describe('when DaemonSet is found with "job" label', () => {
    it('should try "job" label after other labels fail', async () => {
      const daemonSet = createMockDaemonSet("exporter", "default", {
        job: "node-exporter",
      });

      const pods: PodItem[] = [createMockPod("exporter-xyz", "default", "DaemonSet", "exporter")];

      vi.mocked(tauriApi.getClusterDaemonsets)
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [daemonSet] });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(3);
    });
  });

  describe("namespace handling", () => {
    it('should use "default" namespace when namespace is undefined', async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "", {
        "app.kubernetes.io/name": "node-exporter",
      });
      daemonSet.metadata.namespace = undefined;

      const pods: PodItem[] = [
        createMockPod("pod-1", "default", "DaemonSet", "node-exporter-ds"),
        createMockPod("pod-2", "other-ns", "DaemonSet", "node-exporter-ds"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.namespace).toBe("default");
    });

    it("should filter pods by correct namespace", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "monitoring", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("pod-1", "monitoring", "DaemonSet", "node-exporter-ds"),
        createMockPod("pod-2", "default", "DaemonSet", "node-exporter-ds"),
        createMockPod("pod-3", "kube-system", "DaemonSet", "node-exporter-ds"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.namespace).toBe("monitoring");
    });
  });

  describe("owner reference filtering", () => {
    it("should only include pods owned by DaemonSet kind", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "default", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("pod-ds", "default", "DaemonSet", "node-exporter-ds"),
        createMockPod("pod-deploy", "default", "Deployment", "node-exporter-ds"),
        createMockPod("pod-stateful", "default", "StatefulSet", "node-exporter-ds"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("pod-ds");
    });

    it("should only include pods owned by the specific DaemonSet name", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "default", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("pod-1", "default", "DaemonSet", "node-exporter-ds"),
        createMockPod("pod-2", "default", "DaemonSet", "other-daemonset"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("pod-1");
    });

    it("should handle pods without ownerReferences", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "default", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const podWithoutOwner: PodItem = {
        ...createMockPod("pod-orphan", "default", "DaemonSet", "node-exporter-ds"),
        metadata: {
          name: "pod-orphan",
          namespace: "default",
        },
      };

      const pods: PodItem[] = [
        createMockPod("pod-owned", "default", "DaemonSet", "node-exporter-ds"),
        podWithoutOwner,
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("pod-owned");
    });
  });

  describe("when no matching DaemonSet is found", () => {
    it("should return empty array when no DaemonSets exist", async () => {
      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({ items: [] });

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toEqual([]);
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(3);
    });

    it("should return empty array when DaemonSets exist but none match", async () => {
      const otherDaemonSet = createMockDaemonSet("other-ds", "default", {
        app: "some-other-app",
      });

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [otherDaemonSet],
      });

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toEqual([]);
    });

    it("should return empty array when getClusterDaemonsets returns null", async () => {
      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue(null);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toEqual([]);
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(3);
    });
  });

  describe("when DaemonSet is found but no pods match", () => {
    it("should continue searching with next label if no pods match", async () => {
      const daemonSet1 = createMockDaemonSet("ds-1", "default", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const daemonSet2 = createMockDaemonSet("ds-2", "monitoring", {
        app: "node-exporter",
      });

      const pods: PodItem[] = [createMockPod("pod-1", "monitoring", "DaemonSet", "ds-2")];

      vi.mocked(tauriApi.getClusterDaemonsets)
        .mockResolvedValueOnce({ items: [daemonSet1] })
        .mockResolvedValueOnce({ items: [daemonSet2] });

      vi.mocked(tauriApi.getAllPods)
        .mockResolvedValueOnce([]) // No pods for first DaemonSet
        .mockResolvedValueOnce(pods); // Pods found for second DaemonSet

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.name).toBe("pod-1");
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("should log error and continue with next label when getClusterDaemonsets throws", async () => {
      const error = new Error("API Error");
      const daemonSet = createMockDaemonSet("node-exporter-ds", "default", {
        app: "node-exporter",
      });

      const pods: PodItem[] = [createMockPod("pod-1", "default", "DaemonSet", "node-exporter-ds")];

      vi.mocked(tauriApi.getClusterDaemonsets)
        .mockRejectedValueOnce(error) // First label fails
        .mockResolvedValueOnce({ items: [daemonSet] }); // Second label succeeds
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);
      vi.mocked(logPlugin.error).mockResolvedValue(undefined);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(logPlugin.error).toHaveBeenCalledWith(
        expect.stringContaining("Error checking DaemonSet with label app.kubernetes.io/name"),
      );
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(2);
    });

    it("should log error and continue when getAllPods throws", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "default", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const podsError = new Error("Failed to get pods");
      const successPods: PodItem[] = [
        createMockPod("pod-1", "monitoring", "DaemonSet", "other-ds"),
      ];

      const successDaemonSet = createMockDaemonSet("other-ds", "monitoring", {
        app: "node-exporter",
      });

      vi.mocked(tauriApi.getClusterDaemonsets)
        .mockResolvedValueOnce({ items: [daemonSet] })
        .mockResolvedValueOnce({ items: [successDaemonSet] });

      vi.mocked(tauriApi.getAllPods)
        .mockRejectedValueOnce(podsError)
        .mockResolvedValueOnce(successPods);

      vi.mocked(logPlugin.error).mockResolvedValue(undefined);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(logPlugin.error).toHaveBeenCalled();
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(2);
    });

    it("should return empty array when all labels fail with errors", async () => {
      const error = new Error("API Error");

      vi.mocked(tauriApi.getClusterDaemonsets).mockRejectedValue(error);
      vi.mocked(logPlugin.error).mockResolvedValue(undefined);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toEqual([]);
      expect(logPlugin.error).toHaveBeenCalledTimes(3);
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(3);
    });

    it("should include error details in log message", async () => {
      const errorMessage = "Connection timeout";
      const error = new Error(errorMessage);

      vi.mocked(tauriApi.getClusterDaemonsets).mockRejectedValue(error);
      vi.mocked(logPlugin.error).mockResolvedValue(undefined);

      await findPrometheusNodeExporter(mockClusterId);

      expect(logPlugin.error).toHaveBeenCalledWith(expect.stringContaining(errorMessage));
    });
  });

  describe("label matching behavior", () => {
    it('should match label value that includes "node-exporter" substring', async () => {
      const daemonSet = createMockDaemonSet("ds", "default", {
        "app.kubernetes.io/name": "my-node-exporter-service",
      });

      const pods: PodItem[] = [createMockPod("pod-1", "default", "DaemonSet", "ds")];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
    });

    it("should not match label when DaemonSet has no labels", async () => {
      const daemonSet = createMockDaemonSet("ds", "default", {});
      daemonSet.metadata.labels = undefined;

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toEqual([]);
    });

    it("should handle case when specific label does not exist on DaemonSet", async () => {
      const daemonSet = createMockDaemonSet("ds", "default", {
        "some-other-label": "node-exporter",
      });

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toEqual([]);
    });
  });

  describe("early exit optimization", () => {
    it("should stop searching after finding pods with first matching label", async () => {
      const daemonSet = createMockDaemonSet("node-exporter-ds", "default", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const pods: PodItem[] = [createMockPod("pod-1", "default", "DaemonSet", "node-exporter-ds")];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(tauriApi.getClusterDaemonsets).toHaveBeenCalledTimes(1);
      expect(tauriApi.getAllPods).toHaveBeenCalledTimes(1);
    });
  });

  describe("multiple DaemonSets in response", () => {
    it("should use first matching DaemonSet from items array", async () => {
      const daemonSet1 = createMockDaemonSet("first-ds", "ns1", {
        "app.kubernetes.io/name": "node-exporter",
      });

      const daemonSet2 = createMockDaemonSet("second-ds", "ns2", {
        "app.kubernetes.io/name": "prometheus-node-exporter",
      });

      const pods: PodItem[] = [
        createMockPod("pod-1", "ns1", "DaemonSet", "first-ds"),
        createMockPod("pod-2", "ns2", "DaemonSet", "second-ds"),
      ];

      vi.mocked(tauriApi.getClusterDaemonsets).mockResolvedValue({
        items: [daemonSet1, daemonSet2],
      });
      vi.mocked(tauriApi.getAllPods).mockResolvedValue(pods);

      const result = await findPrometheusNodeExporter(mockClusterId);

      expect(result).toHaveLength(1);
      expect(result[0].metadata.namespace).toBe("ns1");
      expect(result[0].metadata.name).toBe("pod-1");
    });
  });
});
