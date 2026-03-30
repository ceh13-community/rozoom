import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkNodeExporter } from "./check-node-exporter";
import { getAllPods } from "$shared/api/tauri";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import type { PodItem } from "$shared/model/clusters";

vi.mock("@/lib/shared/api/tauri", () => ({
  getAllPods: vi.fn(),
  getClusterDaemonsets: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(undefined),
  debug: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

describe("checkNodeExporter", () => {
  const clusterId = "test-cluster";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return resultsform pods in 'monitoring' namespace", async () => {
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "node-exporter-abc123",
          namespace: "monitoring",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { nodeName: "node-1", containers: [], volumes: [] },
      },
      {
        metadata: {
          name: "node-exporter-def456",
          namespace: "monitoring",
          labels: { app: "node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { nodeName: "node-2", containers: [], volumes: [] },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);

    const metricsOutput = "# HELP node_cpu_seconds_total\n# TYPE node_cpu_seconds_total counter\n";
    vi.mocked(kubectlRawFront)
      .mockResolvedValueOnce({ output: metricsOutput, errors: "" })
      .mockResolvedValueOnce({ output: metricsOutput, errors: "" });

    const result = await checkNodeExporter(clusterId);

    expect(result.status).toHaveLength(2);
    expect(result.status[0]).toEqual({ nodeName: "node-1", result: 1 });
    expect(result.status[1]).toEqual({ nodeName: "node-2", result: 1 });
    expect(result.title).toBe("Node Exporter");
    expect(result.lastSync).toBeDefined();
    expect(result.errors).toBeUndefined();
  });

  it("should return error if pods are found but no metrics", async () => {
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "node-exporter-xyz",
          namespace: "monitoring",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { nodeName: "node-1", containers: [], volumes: [] },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: "plain text no metrics", errors: "" });

    const result = await checkNodeExporter(clusterId);

    expect(result.status[0].result).toBe(0);
    expect(result.status[0].nodeName).toBe("node-1");
  });

  it("should ignore pods from not 'monitoring' namespace and not correct labels", async () => {
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: { name: "some-other-pod", namespace: "default" },
        spec: { nodeName: "node-1", containers: [], volumes: [] },
      },
      {
        metadata: {
          name: "node-exporter-old",
          namespace: "monitoring",
          labels: { unrelated: "label" },
        },
        spec: { nodeName: "node-2", containers: [], volumes: [] },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);

    const result = await checkNodeExporter(clusterId);

    expect(result.status).toHaveLength(1);
  });

  it("should return default result if no pods in monitoring namespace and fallback didn't work", async () => {
    vi.mocked(getAllPods).mockResolvedValue([]);

    const result = await checkNodeExporter(clusterId);

    expect(result.status).toHaveLength(1);
    expect(result.title).toBe("Node Exporter");
    expect(result.lastSync).toBeDefined();
    expect(result.errors).toBeUndefined();
  });

  it("should process error from kubectlRawFront", async () => {
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "node-exporter-fail",
          namespace: "monitoring",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { nodeName: "node-1", containers: [], volumes: [] },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);
    vi.mocked(kubectlRawFront).mockRejectedValue(new Error("Connection refused"));

    const result = await checkNodeExporter(clusterId);

    expect(result.status[0].result).toBe(0);
  });

  it("should process error from getAllPods", async () => {
    vi.mocked(getAllPods).mockRejectedValue(new Error("Failed to fetch pods"));

    const result = await checkNodeExporter(clusterId);

    expect(result.status).toHaveLength(1);
    expect(result.errors).toBeDefined();
    // expect(result.errors![0]).toContain("Failed to fetch pods");
  });

  it("should degrade safely when pod discovery returns a non-array payload", async () => {
    vi.mocked(getAllPods).mockResolvedValue("boom" as unknown as PodItem[]);

    const result = await checkNodeExporter(clusterId);

    expect(result.status).toHaveLength(1);
    expect(result.errors).toBeUndefined();
  });

  it("should use pod.metadata.name as nodeNam if no pod.spec.nodeName", async () => {
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "node-exporter-fallback",
          namespace: "monitoring",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { containers: [], nodeName: "", volumes: [] },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);
    vi.mocked(kubectlRawFront).mockResolvedValue({
      output: "# HELP node_cpu\n# TYPE node_cpu counter\n",
      errors: "",
    });

    const result = await checkNodeExporter(clusterId);

    expect(result.status[0].nodeName).toBe("node-exporter-fallback");
    expect(result.status[0].result).toBe(1);
  });
});
