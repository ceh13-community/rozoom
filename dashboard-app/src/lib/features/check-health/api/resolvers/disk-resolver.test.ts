import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDisk, resolveDiskWithTrace } from "./disk-resolver";
import * as nodeDiskSpace from "../node-disk-space";
import { diskFromKubeletSummary, diskFromPrometheus } from "../metrics-resolvers";
import * as capabilitiesApi from "./metrics-capabilities";

vi.mock("../node-disk-space");
vi.mock("../metrics-resolvers", () => ({
  diskFromKubeletSummary: {
    id: "disk-kubelet-summary",
    title: "Kubelet Summary",
    canResolve: vi.fn(),
    resolve: vi.fn(),
  },
  diskFromPrometheus: {
    id: "disk-prometheus",
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

describe("resolveDiskWithTrace", () => {
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

  it("resolves from API first", async () => {
    vi.mocked(diskFromKubeletSummary.canResolve).mockResolvedValue(true);
    vi.mocked(diskFromKubeletSummary.resolve).mockResolvedValue([
      { name: "node-1", freeGiB: 100.25 },
      { name: "node-2", freeGiB: 50.1 },
    ]);

    const result = await resolveDiskWithTrace(clusterId, ["node-1", "node-2"]);

    expect(result.data).toEqual({
      "node-1": "100.25 GiB",
      "node-2": "50.10 GiB",
    });
    expect(result.trace.resolvedFrom).toBe("api");
    expect(nodeDiskSpace.getNodeAvailableDiskSpace).not.toHaveBeenCalled();
  });

  it("falls back to node-exporter after API", async () => {
    vi.mocked(diskFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(nodeDiskSpace.getNodeAvailableDiskSpace)
      .mockResolvedValueOnce({ success: true, availableGiB: 10 } as any)
      .mockResolvedValueOnce({ success: true, availableGiB: 20 } as any);

    const result = await resolveDiskWithTrace(clusterId, ["node-1", "node-2"]);

    expect(result.data).toEqual({
      "node-1": "10.00 GiB",
      "node-2": "20.00 GiB",
    });
    expect(result.trace.resolvedFrom).toBe("node_exporter");
    expect(result.trace.attempts.map((item) => item.source)).toContain("metrics_server");
    expect(result.trace.attempts.map((item) => item.source)).toContain("node_exporter");
  });

  it("falls back to prometheus for remaining nodes", async () => {
    vi.mocked(diskFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(nodeDiskSpace.getNodeAvailableDiskSpace)
      .mockResolvedValueOnce({ success: true, availableGiB: 10 } as any)
      .mockResolvedValueOnce({ success: false, availableGiB: 0 } as any);
    vi.mocked(diskFromPrometheus.canResolve).mockResolvedValue(true);
    vi.mocked(diskFromPrometheus.resolve).mockResolvedValue([{ name: "node-2", freeGiB: 33.3 }]);

    const result = await resolveDiskWithTrace(clusterId, ["node-1", "node-2"]);

    expect(result.data).toEqual({
      "node-1": "10.00 GiB",
      "node-2": "33.30 GiB",
    });
  });

  it("returns N/A when all sources fail", async () => {
    vi.mocked(diskFromKubeletSummary.canResolve).mockResolvedValue(false);
    vi.mocked(nodeDiskSpace.getNodeAvailableDiskSpace).mockResolvedValue({
      success: false,
      availableGiB: 0,
    } as any);
    vi.mocked(diskFromPrometheus.canResolve).mockResolvedValue(false);

    const result = await resolveDiskWithTrace(clusterId, ["node-1"]);

    expect(result.data).toEqual({ "node-1": "N/A" });
    expect(result.trace.quality).toBe("low");
  });

  it("returns empty object for empty node list", async () => {
    const result = await resolveDiskWithTrace(clusterId, []);
    expect(result.data).toEqual({});
  });

  it("returns helper wrapper output", async () => {
    vi.mocked(diskFromKubeletSummary.canResolve).mockResolvedValue(true);
    vi.mocked(diskFromKubeletSummary.resolve).mockResolvedValue({ name: "node-1", freeGiB: 11 });

    const result = await resolveDisk(clusterId, ["node-1"]);

    expect(result).toEqual({ "node-1": "11.00 GiB" });
  });

  it("limits node-exporter fallback concurrency", async () => {
    vi.mocked(diskFromKubeletSummary.canResolve).mockResolvedValue(false);

    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(nodeDiskSpace.getNodeAvailableDiskSpace).mockImplementation(
      async (_clusterId, nodeName) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return {
          success: true,
          availableGiB: Number(String(nodeName).replace("node-", "")) || 1,
        } as any;
      },
    );

    const nodes = Array.from({ length: 12 }, (_, index) => `node-${index + 1}`);
    const result = await resolveDiskWithTrace(clusterId, nodes);

    expect(Object.keys(result.data)).toHaveLength(12);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});
