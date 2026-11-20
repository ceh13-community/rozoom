import { describe, expect, it } from "vitest";
import {
  averagePercent,
  buildControlPlaneChecks,
  buildMetricsUnavailableMessage,
  buildOverviewResourceInsights,
  pickWorkloadWarningEvents,
  buildUsageCards,
  calculateResourcePressure,
  detectManagedProvider,
  parseCpuQuantityToCores,
  parseMemoryQuantityToBytes,
  parsePercent,
} from "./overview-insights";
import type { ClusterHealthChecks, WarningEventItem } from "$features/check-health/model/types";
import type { WorkloadOverview } from "$shared";

const overview: WorkloadOverview = {
  nodes: { quantity: 1 },
  pods: { quantity: 4 },
  deployments: { quantity: 2 },
  daemonsets: { quantity: 1 },
  statefulsets: { quantity: 1 },
  replicasets: { quantity: 2 },
  jobs: { quantity: 1 },
  cronjobs: { quantity: 1 },
};

function makeChecks(overrides?: Partial<ClusterHealthChecks>): ClusterHealthChecks {
  return {
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
          pressures: { diskPressure: 0, memoryPressure: 0, pidPressure: 0, networkUnavailable: 0 },
        },
      },
    },
    metricsChecks: {
      endpoints: {
        kubelet: {
          title: "Kubelet",
          status: "✅ Available",
          lastSync: "now",
        },
        metrics_server: {
          title: "Metrics Server",
          status: "❌ Not found",
          lastSync: "now",
        },
      },
    },
    apiServerHealth: {
      status: "ok",
      live: { ok: true, output: "ok" },
      ready: { ok: true, output: "[+]scheduler ok\n[+]controller-manager ok\n[+]etcd ok" },
      updatedAt: Date.now(),
    },
    podIssues: {
      status: "critical",
      summary: { status: "critical", warnings: [], updatedAt: Date.now(), message: "issues" },
      items: [],
      crashLoopCount: 1,
      pendingCount: 0,
      totalPods: 4,
      updatedAt: Date.now(),
    },
    apfHealth: {
      status: "warning",
      summary: { status: "warning", warnings: [], updatedAt: Date.now(), message: "queue high" },
      metrics: null,
      metricRates: {},
      updatedAt: Date.now(),
    },
    etcdHealth: {
      status: "ok",
      summary: { status: "ok", warnings: [], updatedAt: Date.now() },
      health: [],
      endpointStatus: [],
      metrics: [],
      metricRates: {},
      updatedAt: Date.now(),
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("overview-insights", () => {
  it("parses and averages percent values", () => {
    expect(parsePercent("44%")).toBe(44);
    expect(parsePercent("N/A")).toBeNull();
    expect(averagePercent(["40%", "60%", "N/A"])).toBe(50);
  });

  it("builds resource insights with severity from pod issues and warning events", () => {
    const warningItems: WarningEventItem[] = [
      {
        timestamp: Date.now(),
        type: "Warning",
        namespace: "default",
        objectKind: "Deployment",
        objectName: "api",
        reason: "Failed",
        message: "x",
        count: 1,
      },
    ];
    const insights = buildOverviewResourceInsights(overview, makeChecks(), { items: warningItems });
    const podsInsight = insights.find((item) => item.key === "pods");
    const deploymentsInsight = insights.find((item) => item.key === "deployments");
    expect(podsInsight?.severity).toBe("critical");
    expect(deploymentsInsight?.severity).toBe("warning");
  });

  it("returns resource insights in stable UI order", () => {
    const insights = buildOverviewResourceInsights(overview, makeChecks(), { items: [] });
    expect(insights.map((item) => item.key)).toEqual([
      "pods",
      "deployments",
      "daemonsets",
      "statefulsets",
      "replicasets",
      "jobs",
      "cronjobs",
      "nodes",
    ]);
  });

  it("builds usage cards and detects missing metrics", () => {
    const usageCards = buildUsageCards({
      cpuAveragePercent: null,
      memoryAveragePercent: null,
      podCount: 10,
      podCapacity: 100,
    });
    const message = buildMetricsUnavailableMessage(makeChecks(), usageCards);
    expect(message).toContain("CPU and memory metrics are unavailable");
  });

  it("formats used/reserved values for cpu, memory and pods", () => {
    const usageCards = buildUsageCards({
      cpuAveragePercent: 50,
      memoryAveragePercent: 25,
      podCount: 20,
      podCapacity: 100,
      cpuReservedCores: 4,
      memoryReservedBytes: 8 * 1024 ** 3,
    });
    expect(usageCards.find((card) => card.id === "cpu")?.usedReserved).toBe(
      "2.00 cores / 4.00 cores",
    );
    expect(usageCards.find((card) => card.id === "memory")?.usedReserved).toBe(
      "2.00 GiB / 8.00 GiB",
    );
    expect(usageCards.find((card) => card.id === "pods")?.usedReserved).toBe("20 / 100");
  });

  it("does not show metrics warning when checks are unavailable or endpoints are healthy", () => {
    const usageCards = buildUsageCards({
      cpuAveragePercent: null,
      memoryAveragePercent: null,
      podCount: 10,
      podCapacity: 100,
    });
    expect(buildMetricsUnavailableMessage(null, usageCards)).toBeNull();
    expect(
      buildMetricsUnavailableMessage(makeChecks(), usageCards, { coreMetricsUnavailable: false }),
    ).toContain("Metrics sources are available");
    expect(
      buildMetricsUnavailableMessage(
        makeChecks({
          metricsChecks: {
            endpoints: {
              kubelet: { title: "Kubelet", status: "✅ Available", lastSync: "now" },
              metrics_server: { title: "Metrics Server", status: "✅ Available", lastSync: "now" },
            },
          },
        }),
        usageCards,
      ),
    ).toBeNull();
  });

  it("marks managed providers by providerID", () => {
    expect(detectManagedProvider(["aws:///eu-central-1a/i-1"])).toBe(true);
    expect(detectManagedProvider(["baremetal://node-1"])).toBe(false);
  });

  it("builds control-plane checks and marks etcd as N/A on managed clusters", () => {
    const controlPlaneManaged = buildControlPlaneChecks({
      checks: makeChecks(),
      isManagedCluster: true,
    });
    const controlPlaneSelf = buildControlPlaneChecks({
      checks: makeChecks(),
      isManagedCluster: false,
    });
    const etcdManaged = controlPlaneManaged.find((item) => item.id === "etcd");
    const etcdSelf = controlPlaneSelf.find((item) => item.id === "etcd");
    expect(etcdManaged?.severity).toBe("not_applicable");
    expect(etcdSelf?.severity).toBe("ok");
  });

  it("uses kube-system pod fallback for self-managed clusters when /readyz omits scheduler probes", () => {
    const controlPlaneChecks = buildControlPlaneChecks({
      checks: makeChecks({
        apiServerHealth: {
          status: "ok",
          live: { ok: true, output: "ok" },
          ready: { ok: true, output: "readyz check passed" },
          updatedAt: Date.now(),
        },
        controlPlaneComponents: {
          scheduler: {
            source: "pod",
            status: "ok",
            matchedPods: 1,
            readyPods: 1,
            totalRestarts: 0,
            podNames: ["kube-scheduler-minikube"],
            message: "Pod fallback: 1/1 kube-system pod(s) ready.",
          },
          controllerManager: {
            source: "pod",
            status: "ok",
            matchedPods: 1,
            readyPods: 1,
            totalRestarts: 0,
            podNames: ["kube-controller-manager-minikube"],
            message: "Pod fallback: 1/1 kube-system pod(s) ready.",
          },
          updatedAt: Date.now(),
        },
      }),
      isManagedCluster: false,
    });

    expect(controlPlaneChecks.find((item) => item.id === "scheduler")).toMatchObject({
      severity: "ok",
      detail: "Pod fallback: 1/1 kube-system pod(s) ready.",
    });
    expect(controlPlaneChecks.find((item) => item.id === "controller-manager")).toMatchObject({
      severity: "ok",
      detail: "Pod fallback: 1/1 kube-system pod(s) ready.",
    });
  });

  it("treats /readyz as supporting evidence instead of the primary scheduler signal", () => {
    const controlPlaneChecks = buildControlPlaneChecks({
      checks: makeChecks({
        apiServerHealth: {
          status: "ok",
          live: { ok: true, output: "ok" },
          ready: { ok: true, output: "[+]scheduler ok\n[+]controller-manager ok" },
          updatedAt: Date.now(),
        },
        controlPlaneComponents: undefined,
      }),
      isManagedCluster: false,
    });

    expect(controlPlaneChecks.find((item) => item.id === "scheduler")).toMatchObject({
      severity: "unavailable",
      detail: "No visible kube-system control-plane pods. API server /readyz note: [+]scheduler ok",
    });
    expect(controlPlaneChecks.find((item) => item.id === "controller-manager")).toMatchObject({
      severity: "unavailable",
      detail:
        "No visible kube-system control-plane pods. API server /readyz note: [+]controller-manager ok",
    });
  });

  it("marks provider-managed scheduler and controller manager as not applicable when probes are hidden", () => {
    const controlPlaneChecks = buildControlPlaneChecks({
      checks: makeChecks({
        apiServerHealth: {
          status: "ok",
          live: { ok: true, output: "ok" },
          ready: { ok: true, output: "readyz check passed" },
          updatedAt: Date.now(),
        },
        controlPlaneComponents: undefined,
      }),
      isManagedCluster: true,
    });

    expect(controlPlaneChecks.find((item) => item.id === "scheduler")).toMatchObject({
      severity: "not_applicable",
    });
    expect(controlPlaneChecks.find((item) => item.id === "controller-manager")).toMatchObject({
      severity: "not_applicable",
    });
  });

  it("marks self-managed scheduler and controller manager as ok when API server is healthy but pods are not visible", () => {
    const controlPlaneChecks = buildControlPlaneChecks({
      checks: makeChecks({
        apiServerHealth: {
          status: "ok",
          live: { ok: true, output: "ok" },
          ready: { ok: true, output: "readyz check passed" },
          updatedAt: Date.now(),
        },
        controlPlaneComponents: undefined,
      }),
      isManagedCluster: false,
    });

    expect(controlPlaneChecks.find((item) => item.id === "scheduler")).toMatchObject({
      severity: "ok",
      detail: "Not visible as pods (may run as system containers). API server is healthy.",
    });
    expect(controlPlaneChecks.find((item) => item.id === "controller-manager")).toMatchObject({
      severity: "ok",
      detail: "Not visible as pods (may run as system containers). API server is healthy.",
    });
  });

  it("parses cpu and memory allocatable quantities", () => {
    expect(parseCpuQuantityToCores("1500m")).toBe(1.5);
    expect(parseCpuQuantityToCores("2")).toBe(2);
    expect(parseMemoryQuantityToBytes("1Gi")).toBe(1024 ** 3);
    expect(parseMemoryQuantityToBytes("512Mi")).toBe(512 * 1024 ** 2);
  });

  it("calculates resource pressure from pod requests vs node allocatable", () => {
    const nodes = [{ status: { allocatable: { cpu: "4", memory: "8Gi" } } }];
    const pods = [
      {
        status: { phase: "Running" },
        spec: {
          containers: [
            { resources: { requests: { cpu: "500m", memory: "1Gi" } } },
            { resources: { requests: { cpu: "500m", memory: "1Gi" } } },
          ],
        },
      },
      {
        status: { phase: "Pending" },
        spec: {
          containers: [{ resources: { requests: { cpu: "1", memory: "2Gi" } } }],
        },
      },
    ];
    const result = calculateResourcePressure(nodes, pods);
    expect(result.cpuPercent).toBe(50);
    expect(result.memoryPercent).toBe(50);
    expect(result.cpuRequestedCores).toBe(2);
    expect(result.memoryRequestedBytes).toBe(4 * 1024 ** 3);
  });

  it("skips non-running/pending pods in resource pressure", () => {
    const nodes = [{ status: { allocatable: { cpu: "2", memory: "4Gi" } } }];
    const pods = [
      {
        status: { phase: "Running" },
        spec: { containers: [{ resources: { requests: { cpu: "500m", memory: "1Gi" } } }] },
      },
      {
        status: { phase: "Succeeded" },
        spec: { containers: [{ resources: { requests: { cpu: "1", memory: "2Gi" } } }] },
      },
      {
        status: { phase: "Failed" },
        spec: { containers: [{ resources: { requests: { cpu: "500m", memory: "1Gi" } } }] },
      },
    ];
    const result = calculateResourcePressure(nodes, pods);
    expect(result.cpuPercent).toBe(25);
    expect(result.memoryPercent).toBe(25);
  });

  it("returns null percentages when no nodes are available", () => {
    const result = calculateResourcePressure([], []);
    expect(result.cpuPercent).toBeNull();
    expect(result.memoryPercent).toBeNull();
  });

  it("handles pods without resource requests", () => {
    const nodes = [{ status: { allocatable: { cpu: "4", memory: "8Gi" } } }];
    const pods = [
      { status: { phase: "Running" }, spec: { containers: [{}] } },
      { status: { phase: "Running" }, spec: { containers: [{ resources: {} }] } },
    ];
    const result = calculateResourcePressure(nodes, pods);
    expect(result.cpuPercent).toBe(0);
    expect(result.memoryPercent).toBe(0);
  });

  it("aggregates allocatable across multiple nodes", () => {
    const nodes = [
      { status: { allocatable: { cpu: "2", memory: "4Gi" } } },
      { status: { allocatable: { cpu: "2", memory: "4Gi" } } },
    ];
    const pods = [
      {
        status: { phase: "Running" },
        spec: { containers: [{ resources: { requests: { cpu: "2", memory: "4Gi" } } }] },
      },
    ];
    const result = calculateResourcePressure(nodes, pods);
    expect(result.cpuPercent).toBe(50);
    expect(result.memoryPercent).toBe(50);
  });

  it("shows requested labels in usage cards when mode is requested", () => {
    const cards = buildUsageCards({
      cpuAveragePercent: 30,
      memoryAveragePercent: 40,
      podCount: 10,
      podCapacity: 100,
      mode: "requested",
    });
    expect(cards.find((c) => c.id === "cpu")?.title).toBe("CPU requested");
    expect(cards.find((c) => c.id === "memory")?.title).toBe("Memory requested");
    expect(cards.find((c) => c.id === "cpu")?.hint).toContain("Install metrics-server");
  });

  it("shows usage labels in usage cards when mode is actual", () => {
    const cards = buildUsageCards({
      cpuAveragePercent: 30,
      memoryAveragePercent: 40,
      podCount: 10,
      podCapacity: 100,
      mode: "actual",
    });
    expect(cards.find((c) => c.id === "cpu")?.title).toBe("CPU usage");
    expect(cards.find((c) => c.id === "memory")?.title).toBe("Memory usage");
  });

  // A user who may not list workloads, or an Overview with live diagnostics paused, has read
  // no warning events at all. The tiles said "OK, no warning events" all the same.
  describe("workload tiles without data", () => {
    const workloadKeys = ["deployments", "daemonsets", "statefulsets", "replicasets", "jobs"];

    it("shows the workload tiles as unknown when no warning events were read", () => {
      const insights = buildOverviewResourceInsights(overview, makeChecks(), null);
      for (const key of workloadKeys) {
        const insight = insights.find((item) => item.key === key);
        expect(insight?.severity).toBe("unknown");
        expect(insight?.reason).toBe("Warning events not loaded.");
      }
    });

    it("shows the cronjob tile as unknown before any health check result", () => {
      const insights = buildOverviewResourceInsights(overview, null, null);
      const cronjobs = insights.find((item) => item.key === "cronjobs");
      expect(cronjobs?.severity).toBe("unknown");
      expect(cronjobs?.reason).toBe("No cronjob check results yet.");
    });

    it("shows the cronjob tile as unknown for a deferred or failed check", () => {
      const placeholder = {
        items: [],
        summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
        updatedAt: 1,
      };
      const deferred = buildOverviewResourceInsights(
        overview,
        makeChecks({ cronJobsHealth: { ...placeholder, deferred: true } }),
        { items: [] },
      ).find((item) => item.key === "cronjobs");
      expect(deferred?.severity).toBe("unknown");
      expect(deferred?.reason).toBe("No cronjob check results yet.");

      const failed = buildOverviewResourceInsights(
        overview,
        makeChecks({ cronJobsHealth: { ...placeholder, error: "forbidden" } }),
        { items: [] },
      ).find((item) => item.key === "cronjobs");
      expect(failed?.severity).toBe("unknown");
      expect(failed?.reason).toBe("Cron job check failed.");

      // Zeros cached by 0.26.4 have no deferred flag; with cron jobs on the cluster they
      // are not a result.
      const cachedZeros = buildOverviewResourceInsights(
        overview,
        makeChecks({ cronJobsHealth: placeholder }),
        { items: [] },
      ).find((item) => item.key === "cronjobs");
      expect(cachedZeros?.severity).toBe("unknown");
      expect(cachedZeros?.reason).toBe("No cronjob check results yet.");

      const noCronJobs = buildOverviewResourceInsights(
        { ...overview, cronjobs: { quantity: 0 } },
        makeChecks({ cronJobsHealth: placeholder }),
        { items: [] },
      ).find((item) => item.key === "cronjobs");
      expect(noCronJobs?.severity).toBe("ok");

      const checked = buildOverviewResourceInsights(
        overview,
        makeChecks({
          cronJobsHealth: { ...placeholder, summary: { ...placeholder.summary, total: 1, ok: 1 } },
        }),
        { items: [] },
      ).find((item) => item.key === "cronjobs");
      expect(checked?.severity).toBe("ok");
    });

    // The warning event list is cut at the newest 500.
    it("does not call a workload OK from a cut event list", () => {
      const jobWarning = (i: number): WarningEventItem => ({
        timestamp: i,
        type: "Warning",
        namespace: "kubearmor",
        objectKind: "Job",
        objectName: `snitch-${i}`,
        reason: "BackoffLimitExceeded",
        message: "x",
        count: 1,
      });
      const full = Array.from({ length: 500 }, (_, i) => jobWarning(i));
      const insights = buildOverviewResourceInsights(overview, makeChecks(), { items: full });
      const deployments = insights.find((item) => item.key === "deployments");
      expect(deployments?.severity).toBe("unknown");
      expect(deployments?.reason).toBe(
        "None of the newest 500 warning events; older ones not loaded.",
      );
      const jobs = insights.find((item) => item.key === "jobs");
      expect(jobs?.severity).toBe("critical");
      expect(jobs?.reason).toBe("500+ warning events.");

      // With per-kind counts over the whole list the cut does not matter.
      const counted = buildOverviewResourceInsights(overview, makeChecks(), {
        items: full,
        kindCounts: { Job: 812 },
      });
      expect(counted.find((item) => item.key === "deployments")?.severity).toBe("ok");
      expect(counted.find((item) => item.key === "jobs")?.reason).toBe("812 warning events.");

      const notCut = buildOverviewResourceInsights(overview, makeChecks(), {
        items: full.slice(0, 499),
      });
      expect(notCut.find((item) => item.key === "deployments")?.severity).toBe("ok");
    });

    it("still shows OK when warning events were read and none matched", () => {
      const insights = buildOverviewResourceInsights(overview, makeChecks(), { items: [] });
      expect(insights.find((item) => item.key === "deployments")?.severity).toBe("ok");
    });
  });

  describe("pickWorkloadWarningEvents", () => {
    const item: WarningEventItem = {
      timestamp: 1,
      type: "Warning",
      namespace: "default",
      objectKind: "Deployment",
      objectName: "api",
      reason: "Failed",
      message: "x",
      count: 1,
    };
    const report = (status: "ok" | "unknown", errors?: string) => ({
      status,
      summary: { status, warnings: [], updatedAt: 1 },
      items: [item],
      kindCounts: { Deployment: 3 },
      errors,
      updatedAt: 1,
    });

    it("prefers the events the Overview loaded itself", () => {
      expect(
        pickWorkloadWarningEvents({
          overviewItems: [],
          overviewEventsLoaded: true,
          overviewEventsError: null,
          checks: makeChecks({ warningEvents: report("ok") }),
        }),
      ).toEqual({ items: [], kindCounts: null });
    });

    it("falls back to the events of the latest health check", () => {
      expect(
        pickWorkloadWarningEvents({
          overviewItems: [],
          overviewEventsLoaded: false,
          overviewEventsError: null,
          checks: makeChecks({ warningEvents: report("ok") }),
        }),
      ).toEqual({ items: [item], kindCounts: { Deployment: 3 } });
    });

    it("returns null when no events were read", () => {
      const base = { overviewItems: [], overviewEventsLoaded: false, overviewEventsError: null };
      expect(pickWorkloadWarningEvents({ ...base, checks: null })).toBeNull();
      expect(pickWorkloadWarningEvents({ ...base, checks: makeChecks() })).toBeNull();
      expect(
        pickWorkloadWarningEvents({
          ...base,
          checks: makeChecks({ warningEvents: report("ok", "forbidden") }),
        }),
      ).toBeNull();
      expect(
        pickWorkloadWarningEvents({
          ...base,
          checks: makeChecks({ warningEvents: report("unknown") }),
        }),
      ).toBeNull();
      expect(
        pickWorkloadWarningEvents({
          overviewItems: [item],
          overviewEventsLoaded: true,
          overviewEventsError: "Warning events timeout after 10000ms",
          checks: null,
        }),
      ).toBeNull();
    });
  });
});
