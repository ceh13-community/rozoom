import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRecommendations,
  getMetricsSourceCapabilities,
  getMissingSourceIds,
  resetMetricsSourceCapabilitiesCache,
} from "./metrics-capabilities";
import * as checkKubeletApi from "../check-kubelet";
import * as checkMetricsServerApi from "../check-metrics-server";
import * as checkNodeExporterApi from "../check-node-exporter";
import * as discoverPromApi from "$shared/api/discover-prometheus";
import { resetFeatureCapabilityCache } from "../../model/feature-capability-cache";

vi.mock("../check-kubelet");
vi.mock("../check-metrics-server");
vi.mock("../check-node-exporter");
vi.mock("@/lib/shared/api/discover-prometheus");

describe("metrics-capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetFeatureCapabilityCache();
    resetMetricsSourceCapabilitiesCache();
  });

  it("returns source capabilities and recommendations", async () => {
    vi.mocked(checkKubeletApi.checkKubelet).mockResolvedValue({
      title: "Kubelet",
      lastSync: "",
      status: [{ nodeName: "node-1", result: 1 }],
    } as any);
    vi.mocked(checkMetricsServerApi.checkMetricsServer).mockResolvedValue({
      title: "Metrics Server",
      lastSync: "",
      status: [{ result: -1 }],
      error: "not installed",
    } as any);
    vi.mocked(checkNodeExporterApi.checkNodeExporter).mockResolvedValue({
      title: "Node Exporter",
      lastSync: "",
      status: [{ nodeName: "node-1", result: 1 }],
    } as any);
    vi.mocked(discoverPromApi.discoverPrometheusService).mockResolvedValue(null);

    const capabilities = await getMetricsSourceCapabilities("cluster-a", { force: true });

    expect(capabilities.find((item) => item.id === "api")?.available).toBe(true);
    expect(capabilities.find((item) => item.id === "metrics_server")?.available).toBe(false);
    expect(capabilities.find((item) => item.id === "prometheus")?.available).toBe(false);

    const missing = getMissingSourceIds(capabilities);
    expect(missing).toEqual(["metrics_server", "prometheus"]);

    const recommendations = buildRecommendations(capabilities);
    expect(recommendations.join(" ")).toContain("metrics-server");
    expect(recommendations.join(" ")).toContain("Prometheus");
  });

  it("uses cache when force=false", async () => {
    vi.mocked(checkKubeletApi.checkKubelet).mockResolvedValue({
      title: "Kubelet",
      lastSync: "",
      status: [{ nodeName: "node-1", result: 1 }],
    } as any);
    vi.mocked(checkMetricsServerApi.checkMetricsServer).mockResolvedValue({
      title: "Metrics Server",
      lastSync: "",
      status: [{ result: 1 }],
    } as any);
    vi.mocked(checkNodeExporterApi.checkNodeExporter).mockResolvedValue({
      title: "Node Exporter",
      lastSync: "",
      status: [{ nodeName: "node-1", result: 1 }],
    } as any);
    vi.mocked(discoverPromApi.discoverPrometheusService).mockResolvedValue({
      name: "prometheus",
      namespace: "monitoring",
      port: 9090,
    });

    await getMetricsSourceCapabilities("cluster-a", { force: true });
    await getMetricsSourceCapabilities("cluster-a");

    expect(checkKubeletApi.checkKubelet).toHaveBeenCalledTimes(1);
    expect(checkMetricsServerApi.checkMetricsServer).toHaveBeenCalledTimes(1);
    expect(checkNodeExporterApi.checkNodeExporter).toHaveBeenCalledTimes(1);
    expect(discoverPromApi.discoverPrometheusService).toHaveBeenCalledTimes(1);
  });

  it("builds capabilities from provided probes without re-running checks", async () => {
    const capabilities = await getMetricsSourceCapabilities("cluster-probes", {
      force: true,
      probes: {
        kubelet: {
          title: "Kubelet",
          lastSync: "",
          status: [{ nodeName: "node-1", result: 1 }],
        } as any,
        metricsServer: { title: "Metrics Server", lastSync: "", status: [{ result: 1 }] } as any,
        nodeExporter: {
          title: "Node Exporter",
          lastSync: "",
          status: [{ nodeName: "node-1", result: 1 }],
        } as any,
        prometheusService: { name: "prometheus", namespace: "monitoring", port: 9090 } as any,
      },
    });

    expect(capabilities.every((item) => item.available)).toBe(true);
    expect(checkKubeletApi.checkKubelet).not.toHaveBeenCalled();
    expect(checkMetricsServerApi.checkMetricsServer).not.toHaveBeenCalled();
    expect(checkNodeExporterApi.checkNodeExporter).not.toHaveBeenCalled();
    expect(discoverPromApi.discoverPrometheusService).not.toHaveBeenCalled();
  });

  it("classifies unavailable and unsupported capability reasons", async () => {
    const capabilities = await getMetricsSourceCapabilities("cluster-errors", {
      force: true,
      probes: {
        kubelet: {
          title: "Kubelet",
          lastSync: "",
          status: [{ nodeName: "node-1", result: -1 }],
          error:
            "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
        } as any,
        metricsServer: {
          title: "Metrics Server",
          lastSync: "",
          status: [{ result: -1 }],
          error: "Metrics API not available",
        } as any,
        nodeExporter: {
          title: "Node Exporter",
          lastSync: "",
          status: [{ nodeName: "node-1", result: -1 }],
          errors: ['error: the server doesn\'t have a resource type "verticalpodautoscalers"'],
        } as any,
        prometheusService: null,
      },
    });

    expect(capabilities.find((item) => item.id === "api")?.reasonCategory).toBe("unreachable");
    expect(capabilities.find((item) => item.id === "metrics_server")?.reasonCategory).toBe(
      "unavailable",
    );
    expect(capabilities.find((item) => item.id === "node_exporter")?.reasonCategory).toBe(
      "unsupported",
    );
  });

  it("reuses feature probe cache after aggregate capabilities ttl expires", async () => {
    vi.mocked(checkKubeletApi.checkKubelet).mockResolvedValue({
      title: "Kubelet",
      lastSync: "",
      status: [{ nodeName: "node-1", result: -1 }],
      error:
        "Unable to connect to the server: dial tcp 192.168.49.2:8443: connect: no route to host",
    } as any);
    vi.mocked(checkMetricsServerApi.checkMetricsServer).mockResolvedValue({
      title: "Metrics Server",
      lastSync: "",
      status: [{ result: -1 }],
      error: "Metrics API not available",
    } as any);
    vi.mocked(checkNodeExporterApi.checkNodeExporter).mockResolvedValue({
      title: "Node Exporter",
      lastSync: "",
      status: [{ nodeName: "node-1", result: -1 }],
      errors: ['error: the server doesn\'t have a resource type "verticalpodautoscalers"'],
    } as any);
    vi.mocked(discoverPromApi.discoverPrometheusService).mockResolvedValue(null);

    await getMetricsSourceCapabilities("cluster-cached", { force: true });
    vi.advanceTimersByTime(31_000);
    await getMetricsSourceCapabilities("cluster-cached");

    expect(checkKubeletApi.checkKubelet).toHaveBeenCalledTimes(1);
    expect(checkMetricsServerApi.checkMetricsServer).toHaveBeenCalledTimes(1);
    expect(checkNodeExporterApi.checkNodeExporter).toHaveBeenCalledTimes(1);
    expect(discoverPromApi.discoverPrometheusService).toHaveBeenCalledTimes(1);
  });
});
