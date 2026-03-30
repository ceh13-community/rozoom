import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCpuRam, resolveCpuRamWithTrace } from "./cpu-ram-resolver";
import * as tauriApi from "$shared/api/tauri";
import { cpuRamFromKubeletSummary, cpuRamFromPrometheus } from "../metrics-resolvers";
import * as capabilitiesApi from "./metrics-capabilities";

vi.mock("@/lib/shared/api/tauri");
vi.mock("../metrics-resolvers", () => ({
  cpuRamFromKubeletSummary: {
    id: "cpu-ram-kubelet-summary",
    title: "Kubelet Summary",
    canResolve: vi.fn(),
    resolve: vi.fn(),
  },
  cpuRamFromPrometheus: {
    id: "cpu-ram-prometheus",
    title: "Prometheus",
    canResolve: vi.fn(),
    resolve: vi.fn(),
  },
}));
vi.mock("./metrics-capabilities", () => ({
  getMetricsSourceCapabilities: vi.fn(),
  getMissingSourceIds: vi.fn(),
  buildRecommendations: vi.fn(),
}));

describe("resolveCpuRamWithTrace", () => {
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

  it("uses API first and stops on success", async () => {
    vi.mocked(cpuRamFromKubeletSummary.canResolve).mockResolvedValue(true);
    vi.mocked(cpuRamFromKubeletSummary.resolve).mockResolvedValue([
      { name: "node-1", cpu: "30%", memory: "40%" },
    ]);

    const result = await resolveCpuRamWithTrace(clusterId);

    expect(result.data).toEqual([{ name: "node-1", cpu: "30%", memory: "40%" }]);
    expect(result.trace.resolvedFrom).toBe("api");
    expect(tauriApi.getNodeMetrics).not.toHaveBeenCalled();
    expect(cpuRamFromPrometheus.canResolve).not.toHaveBeenCalled();
  });

  it("falls back to metrics-server when API fails", async () => {
    vi.mocked(cpuRamFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(tauriApi.getNodeMetrics).mockResolvedValue([
      { name: "node-1", cpu: "50%", memory: "60%" },
    ]);

    const result = await resolveCpuRamWithTrace(clusterId);

    expect(result.trace.resolvedFrom).toBe("metrics_server");
    expect(result.data).toEqual([{ name: "node-1", cpu: "50%", memory: "60%" }]);
  });

  it("falls back to prometheus after node-exporter step", async () => {
    vi.mocked(cpuRamFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(tauriApi.getNodeMetrics).mockResolvedValue([]);
    vi.mocked(cpuRamFromPrometheus.canResolve).mockResolvedValue(true);
    vi.mocked(cpuRamFromPrometheus.resolve).mockResolvedValue([
      { name: "node-2", cpu: "70%", memory: "80%" },
    ]);

    const result = await resolveCpuRamWithTrace(clusterId);

    expect(result.trace.resolvedFrom).toBe("prometheus");
    expect(result.trace.attempts.map((item) => item.source)).toEqual([
      "api",
      "metrics_server",
      "node_exporter",
      "prometheus",
    ]);
    expect(result.data).toEqual([{ name: "node-2", cpu: "70%", memory: "80%" }]);
  });

  it("skips prometheus fallback when disabled", async () => {
    vi.mocked(cpuRamFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(tauriApi.getNodeMetrics).mockResolvedValue([]);

    const result = await resolveCpuRamWithTrace(clusterId, { allowPrometheusFallback: false });

    expect(result.data).toEqual([]);
    expect(result.trace.attempts.map((item) => item.source)).toEqual([
      "api",
      "metrics_server",
      "node_exporter",
      "prometheus",
    ]);
    expect(result.trace.attempts[2]?.status).toBe("skipped");
    expect(result.trace.attempts[3]?.status).toBe("skipped");
    expect(cpuRamFromPrometheus.canResolve).not.toHaveBeenCalled();
  });

  it("returns empty data and low quality when all sources fail", async () => {
    vi.mocked(cpuRamFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(tauriApi.getNodeMetrics).mockResolvedValue([]);
    vi.mocked(cpuRamFromPrometheus.canResolve).mockResolvedValue(false);

    const result = await resolveCpuRamWithTrace(clusterId);

    expect(result.data).toEqual([]);
    expect(result.trace.resolvedFrom).toBeNull();
    expect(result.trace.quality).toBe("low");
  });

  it("returns helper wrapper output", async () => {
    vi.mocked(cpuRamFromKubeletSummary.canResolve).mockResolvedValue(true);
    vi.mocked(cpuRamFromKubeletSummary.resolve).mockResolvedValue({
      name: "node-1",
      cpu: "10%",
      memory: "20%",
    });

    const result = await resolveCpuRam(clusterId);

    expect(result).toEqual([{ name: "node-1", cpu: "10%", memory: "20%" }]);
  });
});
