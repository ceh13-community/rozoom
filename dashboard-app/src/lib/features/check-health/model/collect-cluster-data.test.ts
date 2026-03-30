import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  collectClusterData,
  resetDashboardDiagnosticsEntitySnapshots,
} from "./collect-cluster-data";
import { get } from "svelte/store";
import { clusterStates } from "./watchers";
import type {
  CronJobs,
  ConfigMaps,
  DaemonSets,
  Deployments,
  Jobs,
  NamespaceData,
  NetworkPolicies,
  Nodes,
  PriorityClasses,
  PodDisruptionBudgets,
  Pods,
  ReplicaSets,
  Secrets,
  StatefulSets,
} from "$shared/model/clusters";

const hoisted = vi.hoisted(() => {
  let value: Record<string, unknown> = {};
  return {
    clusterHealthChecks: {
      subscribe(run: (value: Record<string, unknown>) => void) {
        run(value);
        return () => {};
      },
      set(next: Record<string, unknown>) {
        value = next;
      },
      update(updater: (value: Record<string, unknown>) => Record<string, unknown>) {
        value = updater(value);
      },
    },
  };
});

vi.mock("../api/get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

vi.mock("../api/check-api-server-health", () => ({
  checkApiServerHealth: vi.fn().mockResolvedValue({
    live: { ok: true, output: "ok" },
    ready: { ok: true, output: "ok" },
    status: "ok",
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-api-server-latency", () => ({
  checkApiServerLatency: vi.fn().mockResolvedValue({
    status: "ok",
    summary: { status: "ok", warnings: [], updatedAt: 1 },
    overall: {},
    groups: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-certificates-health", () => ({
  checkCertificatesHealth: vi.fn().mockResolvedValue({
    status: "ok",
    summary: { status: "ok", warnings: [], updatedAt: 1 },
    certificates: [],
    kubeletRotation: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-pod-issues", () => ({
  checkPodIssues: vi.fn().mockResolvedValue({
    status: "ok",
    summary: { status: "ok", warnings: [], updatedAt: 1 },
    items: [],
    totalPods: 0,
    crashLoopCount: 0,
    pendingCount: 0,
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-admission-webhooks", () => ({
  checkAdmissionWebhooks: vi.fn().mockResolvedValue({
    status: "ok",
    summary: { status: "ok", message: "OK", warnings: [], updatedAt: 1 },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-etcd-health", () => ({
  checkEtcdHealth: vi.fn().mockResolvedValue({
    status: "ok",
    summary: { status: "ok", warnings: [], updatedAt: 1 },
    health: [],
    endpointStatus: [],
    metrics: [],
    metricRates: {},
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-warning-events", () => ({
  checkWarningEvents: vi.fn().mockResolvedValue({
    status: "ok",
    summary: { status: "ok", warnings: [], updatedAt: 1 },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-resources-hygiene", () => ({
  checkResourcesHygiene: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      bestEffort: 0,
      updatedAt: 1,
    },
    workloads: [],
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-hpa", () => ({
  checkHpaStatus: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-probes-health", () => ({
  checkProbesHealth: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    workloads: [],
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-pod-qos", () => ({
  checkPodQos: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      bestEffort: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-vpa-status", () => ({
  checkVpaStatus: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-topology-ha", () => ({
  checkTopologyHa: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-pdb", () => ({
  checkPdbStatus: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-priority", () => ({
  checkPriorityStatus: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-pod-security", () => ({
  checkPodSecurity: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    namespaces: [],
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-network-isolation", () => ({
  checkNetworkIsolation: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-secrets-hygiene", () => ({
  checkSecretsHygiene: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    encryptionStatus: "unknown",
    updatedAt: 1,
  }),
}));

vi.mock("../api/check-security-hardening", () => ({
  checkSecurityHardening: vi.fn().mockResolvedValue({
    status: "ok",
    summary: {
      status: "ok",
      message: "OK",
      total: 0,
      ok: 0,
      warning: 0,
      critical: 0,
      updatedAt: 1,
    },
    items: [],
    updatedAt: 1,
  }),
}));

vi.mock("./cache-store", () => ({
  recoverHealthChecksCache: vi.fn().mockResolvedValue(true),
  setClusterCheck: vi.fn(),
  sanitizeHealthChecksCache: vi.fn((value) => value),
  clusterHealthChecks: hoisted.clusterHealthChecks,
}));

vi.mock("$shared/cache", () => ({
  getCache: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
  debug: vi.fn().mockResolvedValue(undefined),
  trace: vi.fn().mockResolvedValue(undefined),
}));

const { loadClusterEntities } = await import("../api/get-cluster-info");
const { getCache } = await import("$shared/cache");
const { clusterHealthChecks } = await import("./cache-store");
const { checkApiServerLatency } = await import("../api/check-api-server-latency");
const { checkAdmissionWebhooks } = await import("../api/check-admission-webhooks");
const { checkCertificatesHealth } = await import("../api/check-certificates-health");
const { checkHpaStatus } = await import("../api/check-hpa");
const { checkPodIssues } = await import("../api/check-pod-issues");
const { checkWarningEvents } = await import("../api/check-warning-events");
const { checkVpaStatus } = await import("../api/check-vpa-status");
const { clearActiveDashboardRoute } = await import("$shared/lib/dashboard-route-activity");

const dashboardDiagnosticsSnapshot = {
  resourcesHygiene: { status: "ok", summary: { status: "ok" } },
  hpaStatus: { status: "ok", summary: { status: "ok" } },
  probesHealth: { status: "ok", summary: { status: "ok" } },
  podQos: { status: "ok", summary: { status: "ok" } },
  vpaStatus: { status: "ok", summary: { status: "ok" } },
  topologyHa: { status: "ok", summary: { status: "ok" } },
  pdbStatus: { status: "ok", summary: { status: "ok" } },
  priorityStatus: { status: "ok", summary: { status: "ok" } },
  podSecurity: { status: "ok", summary: { status: "ok" } },
  networkIsolation: { status: "ok", summary: { status: "ok" } },
  secretsHygiene: { status: "ok", summary: { status: "ok" } },
  securityHardening: { status: "ok", summary: { status: "ok" } },
  podIssues: { status: "ok", summary: { status: "ok" } },
  apiServerHealth: {
    live: { ok: true, output: "ok" },
    ready: { ok: true, output: "ok" },
    status: "ok",
    updatedAt: 1,
  },
};

const dashboardDiagnosticsSnapshotWithWarningPodIssues = {
  ...dashboardDiagnosticsSnapshot,
  podIssues: {
    status: "warning",
    summary: { status: "warning", warnings: ["cached"], updatedAt: 1 },
    items: [],
    totalPods: 1,
    crashLoopCount: 0,
    pendingCount: 1,
    updatedAt: 1,
  },
};

describe("collectClusterData - error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCache).mockResolvedValue(null);
    clusterHealthChecks.set({});
    clearActiveDashboardRoute();
    resetDashboardDiagnosticsEntitySnapshots();
  });

  it("should return ClusterCheckError when status !== ok even if errors missing", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      status: "error",
      errors: "",
    });

    const result = await collectClusterData("abc");

    expect(result).toMatchObject({
      errors: "",
      timestamp: expect.any(Number),
    });
  });

  it("should update clusterStates on error", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      status: "error",
      errors: "boom",
    });

    await collectClusterData("abc");

    const state = get(clusterStates)["abc"];

    expect(state).toEqual({
      loading: false,
      error: "boom",
    });
  });

  it("should not crash when items arrays are missing", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      status: "ok",
      daemonsets: {} as DaemonSets,
      deployments: {} as Deployments,
      jobs: {} as Jobs,
      configmaps: {} as ConfigMaps,
      networkpolicies: {} as NetworkPolicies,
      poddisruptionbudgets: {} as PodDisruptionBudgets,
      priorityclasses: {} as PriorityClasses,
      replicasets: {} as ReplicaSets,
      statefulsets: {} as StatefulSets,
      cronjobs: {} as CronJobs,
      pods: {} as Pods,
      namespaces: {} as NamespaceData,
      nodes: {} as Nodes,
      secrets: {} as Secrets,
      name: "abc",
      uuid: "abc",
    });

    await expect(collectClusterData("abc")).resolves.toMatchObject({
      pods: 0,
      deployments: 0,
      replicaSets: 0,
      daemonSets: 0,
      jobs: 0,
      statefulSets: 0,
      cronJobs: 0,
      namespaces: [],
    });
  });

  it("should handle errors in metrics checks gracefully", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      status: "ok",
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      pods: { items: [] },
      namespaces: { items: [] },
      nodes: { items: [] },
      secrets: { items: [] },
      name: "abc",
      uuid: "abc",
    });

    await expect(collectClusterData("abc")).resolves.toMatchObject({
      pods: 0,
      deployments: 0,
      replicaSets: 0,
      daemonSets: 0,
      jobs: 0,
      statefulSets: 0,
      cronJobs: 0,
      namespaces: [],
    });
  });

  it("should not call setClusterCheck when loadedData.status !== ok", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      status: "error",
      errors: "boom",
    });

    const { setClusterCheck } = await import("./cache-store");

    await collectClusterData("abc");

    expect(setClusterCheck).not.toHaveBeenCalled();
  });

  it("does not preload secrets for the main cluster health collection", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      status: "error",
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      errors: "boom",
    });

    await collectClusterData("abc");

    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.not.arrayContaining(["secrets"]),
    );
  });

  it("uses the dashboard bootstrap entity set when no previous card snapshot exists", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      status: "error",
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      errors: "boom",
    });

    await collectClusterData("abc", { mode: "dashboard" });

    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: [
          "pods",
          "deployments",
          "replicasets",
          "nodes",
          "daemonsets",
          "statefulsets",
          "jobs",
          "cronjobs",
          "namespaces",
        ],
        signal: expect.any(AbortSignal),
        lightweight: true,
      }),
    );
  });

  it("does not load diagnostics entities during normal dashboard refresh", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      status: "error",
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      errors: "boom",
    });

    await collectClusterData("abc", { mode: "dashboard" });

    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: expect.not.arrayContaining([
          "configmaps",
          "networkpolicies",
          "poddisruptionbudgets",
          "priorityclasses",
        ]),
      }),
    );
  });

  it("prefers the in-memory dashboard snapshot before falling back to persisted cache", async () => {
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now(),
        namespaces: ["default"],
        daemonSets: 1,
        statefulSets: 1,
        jobs: 1,
        cronJobs: 1,
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      status: "error",
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      errors: "boom",
    });

    await collectClusterData("abc", { mode: "dashboard" });

    expect(getCache).not.toHaveBeenCalled();
  });

  it("reuses previous dashboard-only reports instead of recomputing heavy probes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:00:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        ...dashboardDiagnosticsSnapshotWithWarningPodIssues,
        timestamp: Date.now(),
        podRestarts: [{ pod: "pod-a", namespace: "default", containers: [] }],
        podIssues: {
          status: "warning",
          summary: { status: "warning", warnings: ["cached"], updatedAt: 1 },
          items: [],
          totalPods: 1,
          crashLoopCount: 0,
          pendingCount: 1,
          updatedAt: 1,
        },
        apiServerLatency: {
          status: "warning",
          summary: { status: "warning", warnings: ["cached"], updatedAt: 1 },
          overall: {},
          groups: [],
          updatedAt: 1,
        },
        apiServerHealth: {
          live: { ok: true, output: "cached" },
          ready: { ok: true, output: "cached" },
          status: "ok",
          updatedAt: 1,
        },
        controlPlaneComponents: {
          scheduler: {
            source: "pod",
            status: "ok",
            matchedPods: 1,
            readyPods: 1,
            totalRestarts: 0,
            podNames: ["kube-scheduler-a"],
            message: "cached",
          },
          updatedAt: 1,
        },
        cronJobsHealth: {
          items: [],
          summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
          updatedAt: 1,
        },
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default", "kube-system"],
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: {
        items: [
          {
            metadata: { namespace: "default", name: "pod-a" },
            status: { phase: "Running", containerStatuses: [] },
          },
        ],
      },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any);

    const result = await collectClusterData("abc", { mode: "dashboard" });

    expect(checkApiServerLatency).not.toHaveBeenCalled();
    expect(checkPodIssues).not.toHaveBeenCalled();
    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: ["pods", "deployments", "replicasets", "nodes"],
        lightweight: true,
      }),
    );
    expect(result).toMatchObject({
      podRestarts: [{ pod: "pod-a", namespace: "default", containers: [] }],
      podIssues: expect.objectContaining({ status: "warning" }),
      apiServerLatency: expect.objectContaining({ status: "warning" }),
      apiServerHealth: expect.objectContaining({ status: "ok" }),
      controlPlaneComponents: expect.objectContaining({
        scheduler: expect.objectContaining({ podNames: ["kube-scheduler-a"] }),
      }),
      cronJobsHealth: expect.objectContaining({ summary: expect.objectContaining({ total: 0 }) }),
    });
    vi.useRealTimers();
  });

  it("loads dashboard diagnostics in a single full pass", async () => {
    clearActiveDashboardRoute();
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: {
        items: [
          {
            metadata: { namespace: "default", name: "pod-a" },
            status: { phase: "Running", containerStatuses: [] },
          },
        ],
      },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [{ spec: { providerID: "aws:///us-east-2a/i-1234567890" } as any }] },
      namespaces: { items: [{ metadata: { name: "default" } }] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any);

    await collectClusterData("abc", { mode: "dashboardDiagnostics" });

    expect(loadClusterEntities).toHaveBeenCalledTimes(1);
    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: [
          "pods",
          "nodes",
          "deployments",
          "replicasets",
          "daemonsets",
          "statefulsets",
          "jobs",
          "cronjobs",
          "configmaps",
          "namespaces",
          "networkpolicies",
          "poddisruptionbudgets",
          "priorityclasses",
        ],
        lightweight: false,
        testEntity: "nodes",
      }),
    );
  });

  it("reuses a fresh dashboard diagnostics snapshot without reloading entities", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T18:00:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now() - 30_000,
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default"],
        ...dashboardDiagnosticsSnapshot,
      } as any,
    });

    const result = await collectClusterData("abc", { mode: "dashboardDiagnostics" });

    expect(loadClusterEntities).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      timestamp: Date.now() - 30_000,
      resourcesHygiene: { status: "ok" },
      podIssues: { status: "ok" },
    });
    vi.useRealTimers();
  });

  it("does not run certificates probes for dashboard health diagnostics on cards", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T23:30:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now() - 10 * 60_000,
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default"],
        warningEvents: [],
        apiServerLatency: { status: "ok" },
        podRestarts: [],
        cronJobsHealth: {
          items: [],
          summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
          updatedAt: 1,
        },
        certificatesHealth: {
          status: "warning",
          summary: { status: "warning", warnings: ["cached"], updatedAt: 1 },
          certificates: [],
          kubeletRotation: [],
          updatedAt: 1,
        },
        ...dashboardDiagnosticsSnapshotWithWarningPodIssues,
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    });

    const result = await collectClusterData("abc", { mode: "dashboardHealthDiagnostics" });

    expect(checkCertificatesHealth).toHaveBeenCalled();
    expect(checkAdmissionWebhooks).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not run live hpa or vpa probes for dashboard config diagnostics on cards", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T23:45:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now() - 10 * 60_000,
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default"],
        ...dashboardDiagnosticsSnapshot,
        hpaStatus: { status: "warning", summary: { status: "warning", message: "cached" } },
        vpaStatus: { status: "ok", summary: { status: "ok", message: "cached" } },
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    });

    const result = await collectClusterData("abc", { mode: "dashboardConfigDiagnostics" });

    expect(checkHpaStatus).not.toHaveBeenCalled();
    expect(checkVpaStatus).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      hpaStatus: { status: "warning", summary: { message: "cached" } },
      vpaStatus: { status: "ok", summary: { message: "cached" } },
    });
    vi.useRealTimers();
  });

  it("reruns health diagnostics when only the dashboard timestamp is fresh but the health snapshot marker is stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T23:50:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now(),
        diagnosticsSnapshots: {
          healthLoadedAt: Date.now() - 10 * 60_000,
        },
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default"],
        warningEvents: [],
        podRestarts: [],
        cronJobsHealth: {
          items: [],
          summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
          updatedAt: 1,
        },
        apiServerLatency: { status: "ok" },
        ...dashboardDiagnosticsSnapshotWithWarningPodIssues,
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    });

    await collectClusterData("abc", { mode: "dashboardHealthDiagnostics" });

    expect(checkApiServerLatency).toHaveBeenCalled();
    expect(checkWarningEvents).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reuses recent diagnostics entities when health diagnostics follow config diagnostics", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T23:55:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now() - 10 * 60_000,
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default"],
      } as any,
    });

    const diagnosticsEntityPayload = {
      uuid: "abc",
      pods: {
        items: [
          {
            metadata: {
              namespace: "default",
              name: "pod-a",
              creationTimestamp: "2026-03-15T23:00:00.000Z",
            },
            spec: {} as any,
            status: { phase: "Running", containerStatuses: [] } as any,
          },
        ],
      },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any;
    vi.mocked(loadClusterEntities).mockResolvedValue(diagnosticsEntityPayload);

    await collectClusterData("abc", { mode: "dashboardConfigDiagnostics" });
    await collectClusterData("abc", { mode: "dashboardHealthDiagnostics" });

    expect(loadClusterEntities).toHaveBeenCalledTimes(1);
    expect(checkApiServerLatency).toHaveBeenCalledTimes(1);
    expect(checkPodIssues).toHaveBeenCalledTimes(1);
    expect(checkWarningEvents).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("skips persistent cache writes for recent dashboard snapshots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:00:30.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: new Date("2026-03-15T14:00:00.000Z").getTime(),
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default"],
        ...dashboardDiagnosticsSnapshot,
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: {
        items: [
          { metadata: { namespace: "default", name: "pod-a" }, spec: {} as any, status: {} as any },
        ],
      },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any);

    const { setClusterCheck } = await import("./cache-store");
    await collectClusterData("abc", { mode: "dashboard" });

    expect(setClusterCheck).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ pods: 1, deployments: 0, replicaSets: 0 }),
      { persistToCache: false },
    );
    vi.useRealTimers();
  });

  it("persists dashboard diagnostics snapshots even when the dashboard cache is still fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:05:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now() - 30_000,
        diagnosticsSnapshots: {
          configLoadedAt: Date.now() - 90_000,
          healthLoadedAt: Date.now() - 90_000,
        },
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any);

    const { setClusterCheck } = await import("./cache-store");
    await collectClusterData("abc", { mode: "dashboardHealthDiagnostics" });

    expect(setClusterCheck).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({
        diagnosticsSnapshots: expect.objectContaining({
          healthLoadedAt: Date.now(),
        }),
      }),
      { persistToCache: true },
    );
    vi.useRealTimers();
  });

  it("keeps dashboard slow entities on the fast lane when the card already has cached slow counts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:05:00.000Z"));
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now() - 30_000,
        daemonSets: 2,
        statefulSets: 1,
        jobs: 3,
        cronJobs: 4,
        namespaces: ["default", "kube-system"],
        nodes: {
          summary: {
            count: {
              total: 3,
              ready: 3,
              pressures: {
                disk: 0,
                memory: 0,
                pid: 0,
                network: 0,
              },
            },
            status: "OK",
            className: "bg-emerald-600",
          },
          checks: [],
        },
        ...dashboardDiagnosticsSnapshot,
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    });

    const result = await collectClusterData("abc", { mode: "dashboard" });

    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: ["pods", "deployments", "replicasets"],
        testEntity: "pods",
        lightweight: true,
      }),
    );
    expect(result).toMatchObject({
      daemonSets: 2,
      statefulSets: 1,
      jobs: 3,
      cronJobs: 4,
      namespaces: ["default", "kube-system"],
      nodes: expect.objectContaining({
        summary: expect.objectContaining({
          count: expect.objectContaining({ total: 3, ready: 3 }),
        }),
      }),
    });
    vi.useRealTimers();
  });

  it("bootstraps missing slow card counts when only a partial dashboard snapshot exists", async () => {
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now(),
        nodes: {
          summary: {
            count: {
              total: 3,
              ready: 3,
              pressures: { disk: 0, memory: 0, pid: 0, network: 0 },
            },
            status: "OK",
            className: "bg-emerald-600",
          },
          checks: [],
        },
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: {
        items: [
          {
            metadata: { namespace: "kube-system", name: "ds-a" },
            spec: {} as any,
            status: {} as any,
          },
        ],
      },
      deployments: { items: [] },
      jobs: {
        items: [
          {
            metadata: {
              namespace: "default",
              name: "job-a",
              creationTimestamp: "2026-03-15T00:00:00Z",
            },
          },
        ],
      },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: {
        items: [
          {
            metadata: {
              namespace: "default",
              name: "sts-a",
              creationTimestamp: "2026-03-15T00:00:00Z",
            },
          },
        ],
      },
      cronjobs: {
        items: [
          {
            metadata: {
              namespace: "default",
              name: "cron-a",
              creationTimestamp: "2026-03-15T00:00:00Z",
            },
          },
        ],
      },
      nodes: { items: [] },
      namespaces: {
        items: [{ metadata: { name: "default" } }, { metadata: { name: "kube-system" } }],
      },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any);

    const result = await collectClusterData("abc", { mode: "dashboard" });

    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: [
          "pods",
          "deployments",
          "replicasets",
          "daemonsets",
          "statefulsets",
          "jobs",
          "cronjobs",
          "namespaces",
        ],
        testEntity: "pods",
        lightweight: true,
      }),
    );
    expect(result).toMatchObject({
      daemonSets: 1,
      statefulSets: 1,
      jobs: 1,
      cronJobs: 1,
      namespaces: ["default", "kube-system"],
      nodes: expect.objectContaining({
        summary: expect.objectContaining({
          count: expect.objectContaining({ total: 3, ready: 3 }),
        }),
      }),
    });
  });

  it("re-bootstrap slow card counts when legacy snapshot stored empty namespaces", async () => {
    clusterHealthChecks.set({
      abc: {
        timestamp: Date.now(),
        daemonSets: 0,
        statefulSets: 0,
        jobs: 0,
        cronJobs: 0,
        namespaces: [],
        nodes: {
          summary: {
            count: {
              total: 1,
              ready: 1,
              pressures: { disk: 0, memory: 0, pid: 0, network: 0 },
            },
            status: "OK",
            className: "bg-emerald-600",
          },
          checks: [],
        },
      } as any,
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [{ metadata: { name: "default" } }] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    });

    await collectClusterData("abc", { mode: "dashboard" });

    expect(loadClusterEntities).toHaveBeenCalledWith(
      { uuid: "abc" },
      expect.objectContaining({
        entities: expect.arrayContaining([
          "daemonsets",
          "statefulsets",
          "jobs",
          "cronjobs",
          "namespaces",
        ]),
        testEntity: "pods",
      }),
    );
  });

  it("does not evaluate cronjob schedules from lightweight dashboard entities", async () => {
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: {
        items: [
          {
            metadata: {
              namespace: "default",
              name: "nightly",
              creationTimestamp: "2026-03-15T00:00:00Z",
            },
          },
        ],
      },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: false,
      status: "ok",
    } as any);

    await expect(collectClusterData("abc", { mode: "dashboard" })).resolves.toMatchObject({
      cronJobs: 1,
      cronJobsHealth: expect.objectContaining({
        summary: expect.objectContaining({ total: 0 }),
      }),
    });
  });

  it("recovers from poisoned health cache entries while reading the previous check", async () => {
    vi.mocked(getCache).mockResolvedValueOnce({
      abc: [
        {
          timestamp: 1,
          resourcesHygiene: { extra: new Set(["configmaps"]) },
        },
      ],
    });
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      status: "error",
      errors: "boom",
    });

    await expect(collectClusterData("abc")).resolves.toMatchObject({
      errors: "boom",
      timestamp: expect.any(Number),
    });
  });

  it("clears poisoned health cache when previous check read throws", async () => {
    vi.mocked(getCache).mockRejectedValueOnce(new TypeError("Type error: Set@[native code]"));
    vi.mocked(loadClusterEntities).mockResolvedValueOnce({
      uuid: "abc",
      pods: { items: [] },
      daemonsets: { items: [] },
      deployments: { items: [] },
      jobs: { items: [] },
      configmaps: { items: [] },
      networkpolicies: { items: [] },
      poddisruptionbudgets: { items: [] },
      priorityclasses: { items: [] },
      replicasets: { items: [] },
      statefulsets: { items: [] },
      cronjobs: { items: [] },
      nodes: { items: [] },
      namespaces: { items: [] },
      secrets: { items: [] },
      name: "abc",
      offline: true,
      status: "error",
      errors: "boom",
    });

    const { recoverHealthChecksCache } = await import("./cache-store");

    await collectClusterData("abc");

    expect(recoverHealthChecksCache).toHaveBeenCalled();
  });
});
