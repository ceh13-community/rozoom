import { fireEvent, render, waitFor, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock("svelte-sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("$features/metrics-sources", async () => {
  const { writable } = await import("svelte/store");
  return {
    metricsSourcesConfig: writable({
      cacheTtlMs: 60_000,
      scheduleMs: 60_000,
      maxNodesToProbe: 3,
    }),
    metricsSourcesState: writable({}),
    runMetricsSourcesCheck: vi.fn(),
    startMetricsSourcesPolling: vi.fn(),
    stopMetricsSourcesPolling: vi.fn(),
    markMetricsSourcesUnavailable: vi.fn(),
  };
});

vi.mock("$shared/api/helm", () => ({
  installMetricsServer: vi.fn(),
  installKubeStateMetrics: vi.fn(),
  installNodeExporter: vi.fn(),
}));

import * as metricsSourcesModule from "$features/metrics-sources";
import * as helmModule from "$shared/api/helm";
import MetricsSourcesPanel from "./metrics-sources-panel.svelte";

function seedState() {
  metricsSourcesModule.metricsSourcesState.set({
    "cluster-a": {
      summary: {
        status: "degraded",
        lastRunAt: "2026-02-17T21:00:00.000Z",
        message: "Metrics sources need attention",
      },
      checks: [
        {
          id: "kubelet-cadvisor",
          title: "Kubelet / cAdvisor",
          status: "available",
          checkedAt: "2026-02-17T21:00:00.000Z",
          message: "✅ Available",
          endpoints: [{ url: "/api/v1/nodes/minikube/proxy/metrics", result: 1 }],
        },
        {
          id: "metrics-server",
          title: "metrics-server",
          status: "not_found",
          checkedAt: "2026-02-17T21:00:00.000Z",
          message: "❌ Not found",
          endpoints: [{ url: "/apis/metrics.k8s.io/v1beta1/nodes", result: -1 }],
        },
        {
          id: "kube-state-metrics",
          title: "kube-state-metrics",
          status: "not_found",
          checkedAt: "2026-02-17T21:00:00.000Z",
          message: "❌ Not found",
          endpoints: [{ url: "", result: -1 }],
        },
        {
          id: "node-exporter",
          title: "node-exporter",
          status: "not_found",
          checkedAt: "2026-02-17T21:00:00.000Z",
          message: "❌ Not found",
          endpoints: [{ url: "", result: -1 }],
        },
      ],
    },
  });
}

describe("metrics-sources-panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedState();
    vi.mocked(metricsSourcesModule.runMetricsSourcesCheck).mockResolvedValue({
      summary: {
        status: "ok",
        lastRunAt: "2026-02-17T21:01:00.000Z",
        message: "ok",
      },
      checks: [
        {
          id: "metrics-server",
          title: "metrics-server",
          status: "available",
          checkedAt: "2026-02-17T21:01:00.000Z",
          message: "✅ Available",
          endpoints: [{ url: "/apis/metrics.k8s.io/v1beta1/nodes", result: 1 }],
        },
      ],
    });
    vi.mocked(helmModule.installMetricsServer).mockResolvedValue({ success: true });
    vi.mocked(helmModule.installKubeStateMetrics).mockResolvedValue({ success: true });
    vi.mocked(helmModule.installNodeExporter).mockResolvedValue({ success: true });
  });

  it("shows Helm install action only for missing installable sources", () => {
    const { getAllByRole, getByText, queryByText } = render(MetricsSourcesPanel, {
      props: { clusterId: "cluster-a" },
    });

    expect(getAllByRole("button", { name: "Install (Helm)" })).toHaveLength(3);
    expect(getByText("metrics-server")).toBeInTheDocument();
    expect(getByText("kube-state-metrics")).toBeInTheDocument();
    expect(getByText("node-exporter")).toBeInTheDocument();
    expect(queryByText("Kubelet / cAdvisor")).toBeInTheDocument();
  });

  it("installs metrics-server and shows success notification", async () => {
    const { getByText } = render(MetricsSourcesPanel, {
      props: { clusterId: "cluster-a" },
    });

    const row = getByText("metrics-server").closest("tr");
    expect(row).not.toBeNull();
    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Install (Helm)" }),
    );

    await waitFor(() => {
      expect(helmModule.installMetricsServer).toHaveBeenCalledWith("cluster-a");
      expect(mockToastSuccess).toHaveBeenCalledWith("metrics-server installed and verified.");
    });
  });

  it("shows error when install command succeeds but source is still not available", async () => {
    vi.mocked(metricsSourcesModule.runMetricsSourcesCheck).mockResolvedValueOnce({
      summary: {
        status: "degraded",
        lastRunAt: "2026-02-17T21:02:00.000Z",
        message: "Metrics sources need attention",
      },
      checks: [
        {
          id: "metrics-server",
          title: "metrics-server",
          status: "unreachable",
          checkedAt: "2026-02-17T21:02:00.000Z",
          message: "🟠 Installed but unreachable",
          endpoints: [{ url: "/apis/metrics.k8s.io/v1beta1/nodes", result: 0 }],
        },
      ],
    });

    const { getByText } = render(MetricsSourcesPanel, {
      props: { clusterId: "cluster-a" },
    });

    const row = getByText("metrics-server").closest("tr");
    expect(row).not.toBeNull();
    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Install (Helm)" }),
    );

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "metrics-server install command completed, but endpoint is still unreachable",
      );
    });
  });

  it("shows error notification when install fails", async () => {
    vi.mocked(helmModule.installKubeStateMetrics).mockResolvedValueOnce({
      success: false,
      error: "helm install failed",
    });

    const { getByText } = render(MetricsSourcesPanel, {
      props: { clusterId: "cluster-a" },
    });

    const row = getByText("kube-state-metrics").closest("tr");
    expect(row).not.toBeNull();
    await fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Install (Helm)" }),
    );

    await waitFor(() => {
      expect(helmModule.installKubeStateMetrics).toHaveBeenCalledWith("cluster-a");
      expect(mockToastError).toHaveBeenCalledWith("kube-state-metrics: helm install failed");
    });
  });

  it("renders TLS/SAN issue tag for certificate errors", () => {
    metricsSourcesModule.metricsSourcesState.set({
      "cluster-a": {
        summary: {
          status: "degraded",
          lastRunAt: "2026-02-25T12:56:49.000Z",
          message: "Metrics sources need attention",
        },
        checks: [
          {
            id: "metrics-server",
            title: "metrics-server",
            status: "unreachable",
            checkedAt: "2026-02-25T12:56:49.000Z",
            message: "🟠 Installed but unreachable",
            endpoints: [
              {
                url: "/apis/metrics.k8s.io/v1beta1/nodes",
                result: 0,
                error:
                  "x509: cannot validate certificate for 116.202.102.30 because it doesn't contain any IP SANs",
              },
            ],
          },
        ],
      },
    });

    const { getByText } = render(MetricsSourcesPanel, {
      props: { clusterId: "cluster-a" },
    });

    expect(getByText("TLS/SAN")).toBeInTheDocument();
  });
});
