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

  /**
   * The service-proxy path issues `get services -A -l ...` as the first
   * kubectlRawFront call. Tests that want to exercise the legacy pod-probe
   * paths use this to consume that call with an empty response so
   * tryServiceProxy returns null and the test's subsequent mocks line up
   * with the pod-probe invocations in order.
   */
  const stubEmptyServiceList = () => {
    vi.mocked(kubectlRawFront).mockResolvedValueOnce({ output: "", errors: "" });
  };

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
    stubEmptyServiceList();
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

  it("service-proxy success short-circuits per-pod probes (EKS hostNetwork case)", async () => {
    // Covers the EKS failure reported by users: pod-proxy to hostNetwork
    // nodes is blocked by the managed CNI, so the legacy per-pod /metrics
    // probe would time out for every node. The service proxy still works
    // because it routes via ClusterIP, and one success is enough to mark
    // every Ready pod as available.
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "kps-node-exporter-aaa",
          namespace: "kps",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { nodeName: "ip-10-0-1-1", containers: [], volumes: [] },
      },
      {
        metadata: {
          name: "kps-node-exporter-bbb",
          namespace: "kps",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: { nodeName: "ip-10-0-1-2", containers: [], volumes: [] },
      },
    ];
    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);
    vi.mocked(kubectlRawFront)
      // Service list query - finds the stack's prometheus-node-exporter service
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kps-prometheus-node-exporter",
                namespace: "kps",
                labels: {
                  "app.kubernetes.io/name": "prometheus-node-exporter",
                  "app.kubernetes.io/managed-by": "Helm",
                },
              },
              spec: { ports: [{ name: "metrics", port: 9100 }] },
            },
          ],
        }),
        errors: "",
      })
      // Service-proxy probe returns valid metrics
      .mockResolvedValueOnce({
        output: "# HELP node_cpu_seconds_total\n# TYPE node_cpu_seconds_total counter\n",
        errors: "",
      });

    const result = await checkNodeExporter(clusterId);

    expect(result.installed).toBe(true);
    expect(result.status).toHaveLength(2);
    expect(result.status.every((s) => s.result === 1)).toBe(true);
    expect(result.url).toContain("kps-prometheus-node-exporter:9100");
    // Exactly 2 calls: services list + service-proxy probe. No per-pod hits.
    expect(vi.mocked(kubectlRawFront).mock.calls).toHaveLength(2);
  });

  it("probes the declared container port first, then falls back to 9100", async () => {
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "node-exporter-xyz",
          namespace: "kps",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: {
          nodeName: "worker-1",
          containers: [
            { name: "node-exporter", ports: [{ containerPort: 9100, name: "metrics" }] },
          ] as any,
          volumes: [],
        },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);
    const metricsOutput = "# HELP node_cpu_seconds_total\n# TYPE node_cpu_seconds_total counter\n";
    stubEmptyServiceList();
    vi.mocked(kubectlRawFront).mockResolvedValueOnce({ output: metricsOutput, errors: "" });

    const result = await checkNodeExporter(clusterId);

    expect(result.status[0]).toEqual({ nodeName: "worker-1", result: 1 });
    const probeCall = vi.mocked(kubectlRawFront).mock.calls[1]?.[0];
    expect(probeCall).toContain("/pods/node-exporter-xyz:9100/proxy/metrics");
  });

  it("falls through to a second port when the first one refuses the probe", async () => {
    // Hardened kube-prometheus-stack installs bind node-exporter behind
    // kube-rbac-proxy on 9091 and keep the plain exporter on 9100. The first
    // probe at 9091 hits the proxy which refuses unauthenticated traffic;
    // we must try 9100 next.
    const mockPods: Partial<PodItem>[] = [
      {
        metadata: {
          name: "node-exporter-hardened",
          namespace: "kps",
          labels: { "app.kubernetes.io/name": "prometheus-node-exporter" },
        },
        status: {
          phase: "Running",
          containerStatuses: [{ name: "exporter", ready: true, restartCount: 0, state: {} as any }],
        },
        spec: {
          nodeName: "worker-2",
          containers: [
            {
              name: "kube-rbac-proxy",
              ports: [{ containerPort: 9091, name: "https" }],
            },
            {
              name: "node-exporter",
              ports: [{ containerPort: 9100, name: "metrics" }],
            },
          ] as any,
          volumes: [],
        },
      },
    ];

    vi.mocked(getAllPods).mockResolvedValue(mockPods as PodItem[]);
    stubEmptyServiceList();
    vi.mocked(kubectlRawFront)
      .mockResolvedValueOnce({ output: "", errors: "unauthorized" })
      .mockResolvedValueOnce({
        output: "# HELP node_cpu\n# TYPE node_cpu counter\n",
        errors: "",
      });

    const result = await checkNodeExporter(clusterId);

    expect(result.status[0]).toEqual({ nodeName: "worker-2", result: 1 });
    expect(vi.mocked(kubectlRawFront).mock.calls[1]?.[0]).toContain(":9091/proxy/metrics");
    expect(vi.mocked(kubectlRawFront).mock.calls[2]?.[0]).toContain(":9100/proxy/metrics");
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
