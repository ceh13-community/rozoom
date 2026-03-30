import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePodCpuMemWithTrace } from "./pod-cpu-mem-resolver";
import * as kubectlApi from "$shared/api/kubectl-proxy";
import * as promApi from "$shared/api/discover-prometheus";
import * as capabilitiesApi from "./metrics-capabilities";

vi.mock("@/lib/shared/api/kubectl-proxy");
vi.mock("@/lib/shared/api/discover-prometheus");
vi.mock("./metrics-capabilities", () => ({
  getMetricsSourceCapabilities: vi.fn(),
  getMissingSourceIds: vi.fn(),
  buildRecommendations: vi.fn(),
}));

describe("resolvePodCpuMemWithTrace", () => {
  const clusterId = "cluster-a";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(capabilitiesApi.getMetricsSourceCapabilities).mockResolvedValue([
      { id: "api", title: "Kubelet API", available: true, checkedAt: "2026-02-22T00:00:00.000Z" },
      {
        id: "metrics_server",
        title: "metrics-server",
        available: true,
        checkedAt: "2026-02-22T00:00:00.000Z",
      },
      {
        id: "node_exporter",
        title: "node-exporter",
        available: true,
        checkedAt: "2026-02-22T00:00:00.000Z",
      },
      {
        id: "prometheus",
        title: "Prometheus",
        available: true,
        checkedAt: "2026-02-22T00:00:00.000Z",
      },
    ] as any);
    vi.mocked(capabilitiesApi.getMissingSourceIds).mockReturnValue([] as any);
    vi.mocked(capabilitiesApi.buildRecommendations).mockReturnValue([]);
  });

  it("resolves from api first using kubelet summary", async () => {
    vi.mocked(kubectlApi.kubectlRawFront)
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [{ metadata: { name: "node-1" } }] }),
        errors: "",
        code: 0,
      } as any)
      .mockResolvedValueOnce({
        output: JSON.stringify({
          pods: [
            {
              podRef: { namespace: "default", name: "pod-a" },
              containers: [
                { cpu: { usageNanoCores: 100000000 }, memory: { workingSetBytes: 104857600 } },
              ],
            },
          ],
        }),
        errors: "",
        code: 0,
      } as any);

    const result = await resolvePodCpuMemWithTrace(clusterId);

    expect(result.trace.resolvedFrom).toBe("api");
    expect(result.byKey.get("default/pod-a")?.cpu).toBe("100m");
  });

  it("falls back to metrics-server when api returns empty", async () => {
    vi.mocked(kubectlApi.kubectlRawFront)
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "", code: 0 } as any)
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: { namespace: "ns", name: "pod-b" },
              containers: [{ usage: { cpu: "40m", memory: "120Mi" } }],
            },
          ],
        }),
        errors: "",
        code: 0,
      } as any);

    const result = await resolvePodCpuMemWithTrace(clusterId);

    expect(result.trace.resolvedFrom).toBe("metrics_server");
    expect(result.byKey.get("ns/pod-b")?.cpu).toBe("40m");
  });

  it("falls back to prometheus after api and metrics-server", async () => {
    vi.mocked(kubectlApi.kubectlRawFront)
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "", code: 0 } as any)
      .mockResolvedValueOnce({ output: "", errors: "not available", code: 1 } as any)
      .mockResolvedValueOnce({
        output: JSON.stringify({
          status: "success",
          data: { result: [{ metric: { namespace: "ns", pod: "pod-c" }, value: [0, "12"] }] },
        }),
        errors: "",
        code: 0,
      } as any)
      .mockResolvedValueOnce({
        output: JSON.stringify({
          status: "success",
          data: {
            result: [{ metric: { namespace: "ns", pod: "pod-c" }, value: [0, "104857600"] }],
          },
        }),
        errors: "",
        code: 0,
      } as any);

    vi.mocked(promApi.discoverPrometheusService).mockResolvedValue({
      name: "prometheus",
      namespace: "monitoring",
      port: 9090,
    });

    const result = await resolvePodCpuMemWithTrace(clusterId);

    expect(result.trace.resolvedFrom).toBe("prometheus");
    expect(result.byKey.get("ns/pod-c")?.cpu).toBe("12m");
  });

  it("returns low quality when all sources fail", async () => {
    vi.mocked(kubectlApi.kubectlRawFront)
      .mockResolvedValueOnce({ output: "", errors: "nodes err", code: 1 } as any)
      .mockResolvedValueOnce({ output: "", errors: "metrics err", code: 1 } as any);

    const result = await resolvePodCpuMemWithTrace(clusterId);

    expect(result.trace.resolvedFrom).toBeNull();
    expect(result.trace.quality).toBe("low");
    expect(result.byKey.size).toBe(0);
  });

  it("skips unavailable sources by capabilities", async () => {
    vi.mocked(capabilitiesApi.getMetricsSourceCapabilities).mockResolvedValue([
      { id: "api", title: "Kubelet API", available: false, checkedAt: "" },
      { id: "metrics_server", title: "metrics-server", available: false, checkedAt: "" },
      { id: "node_exporter", title: "node-exporter", available: false, checkedAt: "" },
      { id: "prometheus", title: "Prometheus", available: false, checkedAt: "" },
    ] as any);

    const result = await resolvePodCpuMemWithTrace(clusterId);

    expect(result.trace.attempts.every((item) => item.status === "skipped")).toBe(true);
  });
});
