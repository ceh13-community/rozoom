import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  resetClusterRuntimeContext,
  setClusterRuntimeContext,
} from "$shared/lib/cluster-runtime-manager";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

vi.mock("$shared/api/tauri", () => ({
  getClusterNodesNames: vi.fn(),
}));

vi.mock("$features/check-health", () => ({
  checkMetricsServer: vi.fn(),
  checkKubeStateMetrics: vi.fn(),
  checkNodeExporter: vi.fn(),
}));

vi.mock("$features/check-health/model/cache-store", () => ({
  updateClusterCheckPartially: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { getClusterNodesNames } from "$shared/api/tauri";
import { updateClusterCheckPartially } from "$features/check-health/model/cache-store";
import {
  metricsSourcesConfig,
  metricsSourcesState,
  runMetricsSourcesCheck,
  startMetricsSourcesPolling,
  stopMetricsSourcesPolling,
} from "./store";
import {
  checkKubeStateMetrics,
  checkMetricsServer,
  checkNodeExporter,
} from "$features/check-health";

describe("metrics-sources store", () => {
  const clusterId = "cluster-a";
  const metricsPayload = "# HELP m test\n# TYPE m gauge\n";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetClusterRuntimeContext();
    setClusterRuntimeContext({ activeClusterId: clusterId, metricsEnabled: true });
    metricsSourcesState.set({});
    metricsSourcesConfig.set({
      cacheTtlMs: 60_000,
      scheduleMs: 60_000,
      maxNodesToProbe: Number.MAX_SAFE_INTEGER,
    });
    vi.mocked(getClusterNodesNames).mockResolvedValue(["node-1", "node-2"]);
    vi.mocked(checkMetricsServer).mockResolvedValue({
      installed: true,
      lastSync: "2026-02-25T00:00:00.000Z",
      status: [{ result: 1 }],
      title: "Metrics Server",
      url: "/apis/metrics.k8s.io/v1beta1/nodes",
    });
    vi.mocked(checkKubeStateMetrics).mockResolvedValue({
      lastSync: "2026-02-25T00:00:00.000Z",
      status: [{ result: 1 }],
      title: "Kube State Metrics",
      url: "/api/v1/namespaces/monitoring/services/kube-state-metrics:8080/proxy/metrics",
    });
  });

  afterEach(() => {
    stopMetricsSourcesPolling(clusterId);
    resetClusterRuntimeContext();
    vi.useRealTimers();
  });

  it("marks node-exporter as unreachable when not all cluster nodes are covered", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: metricsPayload, errors: "" });
    vi.mocked(checkNodeExporter).mockResolvedValue({
      installed: true,
      lastSync: "2026-02-25T00:00:00.000Z",
      title: "Node Exporter",
      url: "/api/v1/namespaces/monitoring/pods/node-exporter/proxy/metrics",
      status: [{ nodeName: "node-1", result: 1 }],
    });

    const state = await runMetricsSourcesCheck(clusterId, { force: true });
    const nodeExporter = state.checks.find((check) => check.id === "node-exporter");

    expect(nodeExporter?.status).toBe("unreachable");
    expect(nodeExporter?.endpoints.some((endpoint) => endpoint.error?.includes("node-2"))).toBe(
      true,
    );
    expect(state.summary.status).toBe("degraded");
    expect(updateClusterCheckPartially).toHaveBeenCalledWith(
      clusterId,
      expect.objectContaining({
        metricsSourcesSummary: expect.objectContaining({
          status: "degraded",
          availableCount: 3,
          totalCount: 4,
        }),
        metricsChecks: expect.objectContaining({
          endpoints: expect.objectContaining({
            metrics_server: expect.any(Object),
            kube_state_metrics: expect.any(Object),
            node_exporter: expect.any(Object),
          }),
        }),
      }),
    );
  });

  it("keeps node-exporter available when all cluster nodes are covered and healthy", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: metricsPayload, errors: "" });
    vi.mocked(checkNodeExporter).mockResolvedValue({
      installed: true,
      lastSync: "2026-02-25T00:00:00.000Z",
      title: "Node Exporter",
      url: "/api/v1/namespaces/monitoring/pods/node-exporter/proxy/metrics",
      status: [
        { nodeName: "node-1", result: 1 },
        { nodeName: "node-2", result: 1 },
      ],
    });

    const state = await runMetricsSourcesCheck(clusterId, { force: true });
    const nodeExporter = state.checks.find((check) => check.id === "node-exporter");

    expect(nodeExporter?.status).toBe("available");
    expect(state.summary.status).toBe("ok");
  });

  it("keeps node-exporter as not_found when component is not installed", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: metricsPayload, errors: "" });
    vi.mocked(checkNodeExporter).mockResolvedValue({
      installed: false,
      lastSync: "2026-02-25T00:00:00.000Z",
      title: "Node Exporter",
      status: [{ nodeName: "Unknown", result: -1 }],
    });

    const state = await runMetricsSourcesCheck(clusterId, { force: true });
    const nodeExporter = state.checks.find((check) => check.id === "node-exporter");

    expect(nodeExporter?.status).toBe("not_found");
  });

  it("deduplicates concurrent checks for the same cluster", async () => {
    vi.mocked(kubectlRawFront).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { output: metricsPayload, errors: "" };
    });
    vi.mocked(checkNodeExporter).mockResolvedValue({
      installed: false,
      lastSync: "2026-02-25T00:00:00.000Z",
      title: "Node Exporter",
      status: [{ nodeName: "Unknown", result: -1 }],
    });

    const a = runMetricsSourcesCheck(clusterId, { force: true });
    const b = runMetricsSourcesCheck(clusterId, { force: true });
    await vi.advanceTimersByTimeAsync(10);

    const [first, second] = await Promise.all([a, b]);
    expect(first).toEqual(second);
    expect(getClusterNodesNames).toHaveBeenCalledTimes(1);
    expect(kubectlRawFront).toHaveBeenCalledTimes(4);
    expect(checkMetricsServer).toHaveBeenCalledTimes(1);
    expect(checkKubeStateMetrics).toHaveBeenCalledTimes(1);
    expect(checkNodeExporter).toHaveBeenCalledTimes(1);
  });

  it("skips node-exporter in lightweight checks without mutating shared state", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: metricsPayload, errors: "" });
    vi.mocked(checkNodeExporter).mockResolvedValue({
      installed: true,
      lastSync: "2026-02-25T00:00:00.000Z",
      title: "Node Exporter",
      url: "/api/v1/namespaces/monitoring/pods/node-exporter/proxy/metrics",
      status: [{ nodeName: "node-1", result: 1 }],
    });

    const state = await runMetricsSourcesCheck(clusterId, {
      force: true,
      skipNodeExporter: true,
      persist: false,
    });

    expect(state.checks.some((check) => check.id === "node-exporter")).toBe(false);
    expect(checkNodeExporter).not.toHaveBeenCalled();
    expect(get(metricsSourcesState)[clusterId]).toBeUndefined();
  });

  it("suspends metrics polling when metrics runtime becomes inactive", async () => {
    vi.mocked(kubectlRawFront).mockResolvedValue({ output: metricsPayload, errors: "" });
    vi.mocked(checkNodeExporter).mockResolvedValue({
      installed: false,
      lastSync: "2026-02-25T00:00:00.000Z",
      title: "Node Exporter",
      status: [{ nodeName: "Unknown", result: -1 }],
    });

    startMetricsSourcesPolling(clusterId);
    await vi.advanceTimersByTimeAsync(1);
    expect(checkMetricsServer).toHaveBeenCalledTimes(1);

    setClusterRuntimeContext({ activeClusterId: null });
    vi.clearAllMocks();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(checkMetricsServer).not.toHaveBeenCalled();

    setClusterRuntimeContext({ activeClusterId: clusterId, metricsEnabled: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(checkMetricsServer).toHaveBeenCalledTimes(1);
  });
});
