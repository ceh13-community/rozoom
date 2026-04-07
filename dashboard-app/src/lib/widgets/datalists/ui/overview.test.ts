import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageData } from "$entities/cluster";
import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import { showRuntimeDiagnostics } from "$features/check-health/model/runtime-diagnostics-preferences";

vi.mock("$features/check-health", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$features/check-health")>();
  return {
    ...actual,
    checkWarningEvents: vi.fn(),
    checkCertificatesHealth: vi.fn(),
    getLastHealthCheck: vi.fn(),
  };
});

vi.mock("$features/check-health/api/check-node-health", () => ({
  checkNodesHealth: vi
    .fn()
    .mockResolvedValue([{ name: "node-1", cpuUsage: "35%", memoryUsage: "62%", diskUsage: "N/A" }]),
}));

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlJson: vi.fn().mockResolvedValue({
    items: [
      {
        status: { allocatable: { pods: "110", cpu: "2", memory: "8Gi" } },
        spec: { providerID: "aws:///eu-central-1a/i-123" },
      },
    ],
  }),
  kubectlRawFront: vi.fn().mockImplementation((command: string) => {
    if (command.includes("config view")) {
      return Promise.resolve({
        output: JSON.stringify({
          "current-context": "minikube",
          contexts: [{ name: "minikube", context: { user: "dev-user", namespace: "default" } }],
        }),
        errors: "",
        code: 0,
      });
    }
    return Promise.resolve({ output: "", errors: "", code: 0 });
  }),
  kubectlRawArgsFront: vi.fn().mockImplementation((args: string[]) => {
    if (args[0] === "auth" && args[1] === "whoami") {
      return Promise.resolve({ output: "dev-user\n", errors: "", code: 0 });
    }
    if (args[0] === "auth" && args[1] === "can-i") {
      return Promise.resolve({ output: "yes\n", errors: "", code: 0 });
    }
    return Promise.resolve({ output: "", errors: "", code: 0 });
  }),
}));

vi.mock("$shared/api/tauri", () => ({
  getNodeMetrics: vi.fn().mockResolvedValue([{ name: "node-1", cpu: "35%", memory: "62%" }]),
}));

import * as checkHealth from "$features/check-health";
import Overview from "./overview.svelte";
import { clearOverviewRequestDedupeForTests } from "./model/overview-request-dedupe";

const overviewData: PageData & {
  overview: {
    pods: { quantity: number };
    deployments: { quantity: number };
    daemonsets: { quantity: number };
    statefulsets: { quantity: number };
    replicasets: { quantity: number };
    jobs: { quantity: number };
    cronjobs: { quantity: number };
    nodes: { quantity: number };
  };
} = {
  title: "Overview - Cluster: minikube",
  slug: "cluster-a",
  workload: "overview",
  sort_field: null,
  overview: {
    pods: { quantity: 0 },
    deployments: { quantity: 0 },
    daemonsets: { quantity: 0 },
    statefulsets: { quantity: 0 },
    replicasets: { quantity: 0 },
    jobs: { quantity: 0 },
    cronjobs: { quantity: 0 },
    nodes: { quantity: 0 },
  },
};

describe("overview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    showRuntimeDiagnostics.set(true);
    clearOverviewRequestDedupeForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    showRuntimeDiagnostics.set(false);
  });

  it("falls back from loading state to timeout error when warning events request hangs", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockImplementation(
      () =>
        new Promise(() => {
          // never resolves
        }),
    );
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getAllByText, getByText, queryByText } = render(Overview, {
      props: { data: overviewData },
    });

    expect(getByText(/Live diagnostics are paused/i)).toBeInTheDocument();

    await fireEvent.click(getByText("Events"));

    await vi.advanceTimersByTimeAsync(0);
    expect(getByText(/Loading events/)).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(16_500);
    await vi.advanceTimersByTimeAsync(0);

    expect(queryByText(/Loading events/)).not.toBeInTheDocument();
    expect(getByText("Events unavailable")).toBeInTheDocument();
    expect(getAllByText(/timeout/i).length).toBeGreaterThan(0);
  }, 10_000);

  it("renders control-plane panels immediately and keeps usage diagnostics opt-in", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue({
      daemonSets: 1,
      deployments: 2,
      jobs: 1,
      replicaSets: 2,
      pods: 4,
      statefulSets: 1,
      namespaces: ["default"],
      podRestarts: [],
      cronJobs: 1,
      cronJobsHealth: {
        items: [],
        summary: { total: 1, ok: 1, warning: 0, critical: 0, unknown: 0 },
        updatedAt: Date.now(),
      },
      nodes: {
        checks: [],
        summary: {
          className: "ok",
          status: "Ok",
          count: {
            ready: 1,
            total: 1,
            pressures: {
              diskPressure: 0,
              memoryPressure: 0,
              pidPressure: 0,
              networkUnavailable: 0,
            },
          },
        },
      },
      metricsChecks: {
        endpoints: {
          kubelet: { title: "Kubelet", status: "✅ Available", lastSync: "now" },
          metrics_server: { title: "Metrics Server", status: "✅ Available", lastSync: "now" },
        },
      },
      apiServerHealth: {
        status: "ok",
        live: { ok: true, output: "ok" },
        ready: { ok: true, output: "[+]scheduler ok\n[+]controller-manager ok\n[+]etcd ok" },
        updatedAt: Date.now(),
      },
      timestamp: Date.now(),
    } as never);

    const { getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(getByText("Load live usage")).toBeInTheDocument());
    await waitFor(() => expect(getByText("Control Plane Checks")).toBeInTheDocument());
    await waitFor(() => expect(getByText("Top Risks")).toBeInTheDocument());
    await waitFor(() => expect(getByText("Safe Actions")).toBeInTheDocument());
    await waitFor(() => expect(getByText("Your Access")).toBeInTheDocument());
    await waitFor(() => expect(getByText("dev-user")).toBeInTheDocument());
  });

  it("treats EKS ARN clusters as managed even when provider ids are unavailable", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue({
      daemonSets: 1,
      deployments: 2,
      jobs: 1,
      replicaSets: 2,
      pods: 4,
      statefulSets: 1,
      namespaces: ["default"],
      podRestarts: [],
      cronJobs: 1,
      cronJobsHealth: {
        items: [],
        summary: { total: 1, ok: 1, warning: 0, critical: 0, unknown: 0 },
        updatedAt: Date.now(),
      },
      nodes: null,
      metricsChecks: { endpoints: {} },
      apiServerHealth: {
        status: "ok",
        live: { ok: true, output: "ok" },
        ready: { ok: true, output: "ok" },
        updatedAt: Date.now(),
      },
      timestamp: Date.now(),
    } as never);

    const { getByText, queryByText } = render(Overview, {
      props: {
        data: {
          ...overviewData,
          slug: "arn:aws:eks:us-east-2:058264254041:cluster/test-7env",
          title: "Overview - Cluster: arn:aws:eks:us-east-2:058264254041:cluster/test-7env",
        },
      },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(getByText(/AWS EKS - managed control plane/)).toBeInTheDocument());
    expect(queryByText("Self-managed control plane")).not.toBeInTheDocument();
  });

  it("applies Sync sec change immediately without waiting for next tick", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getByRole } = render(Overview, {
      props: { data: overviewData },
    });

    expect(checkHealth.checkWarningEvents).not.toHaveBeenCalled();

    const syncInput = getByRole("spinbutton") as HTMLInputElement;
    await fireEvent.change(syncInput, { target: { value: "15" } });

    await vi.advanceTimersByTimeAsync(0);

    expect(checkHealth.checkWarningEvents).not.toHaveBeenCalled();
  });

  it("does not block live overview status on hanging usage metrics", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { checkNodesHealth } = await import("$features/check-health/api/check-node-health");
    vi.mocked(checkNodesHealth).mockImplementation(
      () =>
        new Promise(() => {
          // keep usage metrics pending; overview should still mark the base shell live
        }),
    );

    const { getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => {
      expect(getByText(/Live · Updated/i)).toBeInTheDocument();
    });

    expect(getByText("Load live usage")).toBeInTheDocument();
  });

  it("keeps heavy diagnostics lazy on initial overview mount", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getByText } = render(Overview, {
      props: { data: overviewData },
    });

    expect(getByText(/Live diagnostics are paused/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(0);

    expect(checkHealth.checkWarningEvents).not.toHaveBeenCalled();
    expect(checkHealth.checkCertificatesHealth).not.toHaveBeenCalled();
    expect(getByText("Overview Runtime Status")).toBeInTheDocument();
    expect(() => getByText(/updated just now/i)).toThrow();
  });

  it("resumes overview diagnostics without auto-starting live usage metrics", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { checkNodesHealth } = await import("$features/check-health/api/check-node-health");
    const { getByRole, getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => {
      expect(getByText("Load live usage")).toBeInTheDocument();
    });

    await fireEvent.click(getByRole("button", { name: "Resume overview runtime section" }));

    await waitFor(() => {
      expect(checkHealth.checkWarningEvents).toHaveBeenCalled();
    });

    expect(checkNodesHealth).not.toHaveBeenCalled();
    expect(getByText("Load live usage")).toBeInTheDocument();
  });

  it("shows partial-data warning when certificates report returns an error", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "unknown",
      summary: { status: "unknown", warnings: ["timeout"], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      errors: "Certificates timeout after 20000ms",
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { container, getAllByText, getByRole } = render(Overview, {
      props: { data: overviewData },
    });

    await fireEvent.click(getByRole("button", { name: "Certificates" }));
    const tabRefreshButton = container.querySelector(
      ".mt-6 .text-sm.text-primary",
    ) as HTMLButtonElement | null;
    expect(tabRefreshButton).not.toBeNull();
    await fireEvent.click(tabRefreshButton!);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(getAllByText(/Partial data: certificates check is unavailable/i).length).toBeGreaterThan(
      0,
    );
  }, 10_000);

  it("keeps certificates diagnostics manual when opening the certificates tab", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getByRole, getAllByText } = render(Overview, {
      props: { data: overviewData },
    });

    await fireEvent.click(getByRole("button", { name: "Certificates" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(checkHealth.checkCertificatesHealth).not.toHaveBeenCalled();
    expect(getAllByText("Refresh").length).toBeGreaterThan(0);
  });

  it("retries certificates request with backoff on timeout-like failures", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth)
      .mockRejectedValueOnce(new Error("Certificates timeout after 20000ms"))
      .mockResolvedValueOnce({
        status: "ok",
        summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
        certificates: [],
        kubeletRotation: [],
        updatedAt: Date.now(),
      });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { container, getByRole } = render(Overview, {
      props: { data: overviewData },
    });

    await fireEvent.click(getByRole("button", { name: "Certificates" }));
    const tabRefreshButton = container.querySelector(
      ".mt-6 .text-sm.text-primary",
    ) as HTMLButtonElement | null;
    expect(tabRefreshButton).not.toBeNull();
    await fireEvent.click(tabRefreshButton!);
    await vi.advanceTimersByTimeAsync(1_000);

    await waitFor(() => {
      expect(checkHealth.checkCertificatesHealth).toHaveBeenCalledTimes(2);
    });
  });

  it("hydrates cached snapshot immediately and then refreshes in background", async () => {
    const scopeKey = "cluster-a::overview::all::name::none";
    const cachedAt = Date.now() - 5_000;
    window.localStorage.setItem(
      `dashboard.overview.snapshot.v1:${encodeURIComponent(scopeKey)}`,
      JSON.stringify({
        schemaVersion: 1,
        scopeKey,
        cachedAt,
        eventsRows: [
          {
            uid: "cached-event",
            reason: "BackOff",
            object: "Pod default/demo",
            message: "cached event message",
            name: "demo",
            date: "now",
          },
        ],
        certificatesRows: [],
        rotationRows: [],
        warningItems: [],
        eventsError: null,
        certificatesError: null,
        clusterHealth: null,
        clusterHealthError: null,
        usageMetricsError: null,
        cpuAveragePercent: null,
        memoryAveragePercent: null,
        cpuReservedCores: null,
        memoryReservedBytes: null,
        coreMetricsUnavailable: null,
        podCapacity: null,
        providerIds: [],
        usageMetricsLastLoadedAt: 0,
        accessProfile: null,
        accessProfileError: null,
      }),
    );
    window.localStorage.setItem(
      `dashboard.overview.history.v1:${encodeURIComponent(scopeKey)}`,
      JSON.stringify({
        schemaVersion: 1,
        scopeKey,
        entries: [
          {
            capturedAt: Date.now() - 10_000,
            score: 82,
            apiSeverity: 0,
            podsSeverity: 1,
            nodesSeverity: 0,
            controlPlaneSeverity: 0,
            warningCount: 1,
            crashLoopCount: 0,
            pendingCount: 0,
            apiP95: 120,
            minCertificateDays: 12,
          },
          {
            capturedAt: Date.now() - 5_000,
            score: 78,
            apiSeverity: 1,
            podsSeverity: 2,
            nodesSeverity: 0,
            controlPlaneSeverity: 0,
            warningCount: 2,
            crashLoopCount: 1,
            pendingCount: 0,
            apiP95: 180,
            minCertificateDays: 10,
          },
        ],
      }),
    );

    vi.mocked(checkHealth.checkWarningEvents).mockImplementation(
      () =>
        new Promise(() => {
          // keep request pending, we only assert instant cached hydration
        }),
    );
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getByText } = render(Overview, {
      props: { data: overviewData },
    });

    expect(getByText(/Cached .*refreshing/i)).toBeInTheDocument();
    expect(getByText(/Stale baseline/i)).toBeInTheDocument();
    expect(getByText(/History from cache/i)).toBeInTheDocument();
    expect(() => getByText(/cached 5s ago/i)).toThrow();
    expect(() => getByText(/Updating/i)).toThrow();
    expect(checkHealth.getLastHealthCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(349);
    expect(checkHealth.getLastHealthCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await waitFor(() => {
      expect(checkHealth.getLastHealthCheck).toHaveBeenCalledTimes(1);
    });
  });

  it("skips immediate visibility refresh when overview just refreshed", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => {
      expect(checkHealth.getLastHealthCheck).toHaveBeenCalledTimes(1);
    });

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);

    expect(checkHealth.getLastHealthCheck).toHaveBeenCalledTimes(1);
  });

  it("does not hydrate cached snapshot from a different namespace/filter scope", async () => {
    const scopeKey = "cluster-a::overview::all::name::none";
    window.localStorage.setItem(
      `dashboard.overview.snapshot.v1:${encodeURIComponent(scopeKey)}`,
      JSON.stringify({
        schemaVersion: 1,
        scopeKey,
        cachedAt: Date.now() - 5_000,
        eventsRows: [
          {
            uid: "cached-event",
            reason: "BackOff",
            object: "Pod default/demo",
            message: "wrong scope cache",
            name: "demo",
            date: "now",
          },
        ],
        certificatesRows: [],
        rotationRows: [],
        warningItems: [],
        eventsError: null,
        certificatesError: null,
        clusterHealth: null,
        clusterHealthError: null,
        usageMetricsError: null,
        cpuAveragePercent: null,
        memoryAveragePercent: null,
        cpuReservedCores: null,
        memoryReservedBytes: null,
        coreMetricsUnavailable: null,
        podCapacity: null,
        providerIds: [],
        usageMetricsLastLoadedAt: 0,
      }),
    );

    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { queryByText } = render(Overview, {
      props: {
        data: {
          ...overviewData,
          namespace: "kube-system",
          filtersKey: "kube-system::name",
        },
      },
    });

    expect(queryByText(/Cached .*refreshing/i)).not.toBeInTheDocument();
    expect(queryByText("wrong scope cache")).not.toBeInTheDocument();
  });

  it("refreshes top risks without rerunning the access probe", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue({
      daemonSets: 0,
      deployments: 0,
      jobs: 0,
      replicaSets: 0,
      pods: 3,
      statefulSets: 0,
      namespaces: ["default"],
      podRestarts: [],
      cronJobs: 0,
      podIssues: {
        status: "critical",
        crashLoopCount: 3,
        pendingCount: 0,
        summary: { message: "3 crash loops" },
      },
      metricsChecks: { endpoints: {} },
      cronJobsHealth: {
        items: [],
        summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
        updatedAt: Date.now(),
      },
      nodes: {
        checks: [],
        summary: {
          className: "ok",
          status: "Ok",
          count: {
            ready: 1,
            total: 1,
            pressures: {
              diskPressure: 0,
              memoryPressure: 0,
              pidPressure: 0,
              networkUnavailable: 0,
            },
          },
        },
      },
      timestamp: Date.now(),
    } as never);

    const { getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(getByText("Refresh Top Risks now")).toBeInTheDocument());

    const accessProbeCallsBefore = vi
      .mocked(kubectlRawArgsFront)
      .mock.calls.filter(([args]) => args[0] === "auth" && args[1] === "can-i").length;
    const healthCallsBefore = vi.mocked(checkHealth.getLastHealthCheck).mock.calls.length;

    await fireEvent.click(getByText("Refresh Top Risks now"));
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() =>
      expect(vi.mocked(checkHealth.getLastHealthCheck).mock.calls.length).toBeGreaterThan(
        healthCallsBefore,
      ),
    );

    const accessProbeCallsAfter = vi
      .mocked(kubectlRawArgsFront)
      .mock.calls.filter(([args]) => args[0] === "auth" && args[1] === "can-i").length;

    expect(accessProbeCallsAfter).toBe(accessProbeCallsBefore);
  });

  it("reruns the access probe on demand", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(getByText("Re-run access probe")).toBeInTheDocument());

    const accessProbeCallsBefore = vi
      .mocked(kubectlRawArgsFront)
      .mock.calls.filter(([args]) => args[0] === "auth" && args[1] === "can-i").length;

    await fireEvent.click(getByText("Re-run access probe"));
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      const accessProbeCallsAfter = vi
        .mocked(kubectlRawArgsFront)
        .mock.calls.filter(([args]) => args[0] === "auth" && args[1] === "can-i").length;
      expect(accessProbeCallsAfter).toBeGreaterThan(accessProbeCallsBefore);
    });
  });

  it("shows loading labels for async overview buttons", async () => {
    vi.mocked(checkHealth.checkWarningEvents).mockImplementation(
      () =>
        new Promise(() => {
          // keep refresh pending so the button stays in refreshing state
        }),
    );
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);

    const { getNodeMetrics } = await import("$shared/api/tauri");
    vi.mocked(getNodeMetrics).mockImplementation(
      () =>
        new Promise(() => {
          // keep usage load pending for button label
        }),
    );
    const { getByRole, getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await fireEvent.click(getByText("Events"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getByRole("button", { name: /^Refreshing/ })).toBeInTheDocument();

    const usageButton = getByRole("button", { name: "Load live usage" });
    await fireEvent.click(usageButton);
    await vi.advanceTimersByTimeAsync(0);
    expect(getByRole("button", { name: /^Loading/ })).toBeInTheDocument();

    await waitFor(() =>
      expect(getByRole("button", { name: "Re-run access probe" })).toBeInTheDocument(),
    );

    vi.mocked(kubectlRawArgsFront).mockImplementation((args: string[]) => {
      if (args[0] === "auth" && args[1] === "whoami") {
        return Promise.resolve({ output: "dev-user\n", errors: "", code: 0 });
      }
      if (args[0] === "auth" && args[1] === "can-i") {
        return new Promise(() => {
          // keep only manual access rerun pending
        });
      }
      return Promise.resolve({ output: "", errors: "", code: 0 });
    });

    await fireEvent.click(getByRole("button", { name: "Re-run access probe" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      Array.from(document.querySelectorAll("button")).some((button) =>
        button.textContent?.trim().startsWith("Refreshing"),
      ),
    ).toBe(true);
  });

  it("loads usage metrics without triggering metrics-sources diagnostics", async () => {
    const { getNodeMetrics } = await import("$shared/api/tauri");
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);
    vi.mocked(getNodeMetrics).mockImplementation(
      () =>
        new Promise(() => {
          // keep usage refresh in-flight so the click path is observable
        }),
    );

    const { getByRole } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => {
      expect(getByRole("button", { name: "Load live usage" })).toBeInTheDocument();
    });

    await fireEvent.click(getByRole("button", { name: "Load live usage" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(getByRole("button", { name: /^Loading/ })).toBeInTheDocument();
  });

  it("falls back to kubelet summary usage when top nodes returns empty", async () => {
    const { getNodeMetrics } = await import("$shared/api/tauri");
    const { checkNodesHealth } = await import("$features/check-health/api/check-node-health");
    vi.mocked(checkHealth.checkWarningEvents).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      items: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.checkCertificatesHealth).mockResolvedValue({
      status: "ok",
      summary: { status: "ok", warnings: [], message: "", updatedAt: Date.now() },
      certificates: [],
      kubeletRotation: [],
      updatedAt: Date.now(),
    });
    vi.mocked(checkHealth.getLastHealthCheck).mockResolvedValue(null);
    vi.mocked(getNodeMetrics).mockResolvedValue([]);
    vi.mocked(checkNodesHealth).mockResolvedValue([
      { name: "node-1", cpuUsage: "42%", memoryUsage: "55%", diskUsage: "N/A" },
    ]);

    const { getByRole, getByText } = render(Overview, {
      props: { data: overviewData },
    });

    await vi.advanceTimersByTimeAsync(0);
    await fireEvent.click(getByRole("button", { name: "Load live usage" }));
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      expect(getByText("42%")).toBeInTheDocument();
      expect(getByText("55%")).toBeInTheDocument();
    });

    expect(checkNodesHealth).toHaveBeenCalledWith("cluster-a", undefined, {
      includeDisk: false,
      allowPrometheusFallback: false,
    });
  });
});
