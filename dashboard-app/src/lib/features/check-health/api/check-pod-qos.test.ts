import { beforeEach, describe, expect, it, vi } from "vitest";

const loadClusterEntitiesMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: loadClusterEntitiesMock,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
}));

function makeClusterData(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    errors: undefined,
    pods: { items: [] },
    deployments: { items: [] },
    statefulsets: { items: [] },
    daemonsets: { items: [] },
    replicasets: { items: [] },
    ...overrides,
  };
}

function makePod(
  name: string,
  namespace: string,
  opts: {
    qosClass?: string;
    labels?: Record<string, string>;
    ownerKind?: string;
    ownerName?: string;
    containers?: Array<{
      name: string;
      resources?: {
        requests?: { cpu?: string; memory?: string };
        limits?: { cpu?: string; memory?: string };
      };
    }>;
  } = {},
) {
  return {
    metadata: {
      name,
      namespace,
      labels: opts.labels ?? {},
      ownerReferences: opts.ownerKind
        ? [{ kind: opts.ownerKind, name: opts.ownerName ?? "owner" }]
        : undefined,
    },
    status: {
      phase: "Running",
      qosClass: opts.qosClass,
    },
    spec: {
      containers: opts.containers ?? [
        {
          name: "main",
          resources: {
            requests: { cpu: "100m", memory: "128Mi" },
            limits: { cpu: "200m", memory: "256Mi" },
          },
        },
      ],
    },
  };
}

describe("check-pod-qos", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    loadClusterEntitiesMock.mockReset();
    logErrorMock.mockReset();
  });

  it("returns ok when all pods have Burstable or Guaranteed QoS", async () => {
    const data = makeClusterData({
      pods: {
        items: [
          makePod("pod-1", "default", { qosClass: "Burstable" }),
          makePod("pod-2", "default", { qosClass: "Guaranteed" }),
        ],
      },
    });

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-1", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(2);
    expect(report.summary.ok).toBe(2);
  });

  it("reports warning for BestEffort pods", async () => {
    const data = makeClusterData({
      pods: {
        items: [
          makePod("be-pod", "default", {
            qosClass: "BestEffort",
            containers: [{ name: "main", resources: {} }],
          }),
        ],
      },
    });

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-2", { force: true, data: data as never });

    expect(report.status).toBe("warning");
    expect(report.items[0].qosClass).toBe("BestEffort");
    expect(report.items[0].status).toBe("warning");
  });

  it("reports critical for BestEffort pod with critical label", async () => {
    const data = makeClusterData({
      pods: {
        items: [
          makePod("critical-be", "default", {
            qosClass: "BestEffort",
            labels: { "kubemaster.io/critical": "true" },
            containers: [{ name: "main", resources: {} }],
          }),
        ],
      },
    });

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-3", { force: true, data: data as never });

    expect(report.status).toBe("critical");
    expect(report.items[0].status).toBe("critical");
  });

  it("returns ok with empty pods list", async () => {
    const data = makeClusterData();

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-4", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });

  it("handles loadClusterEntities error gracefully", async () => {
    loadClusterEntitiesMock.mockRejectedValueOnce(new Error("connection timeout"));

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-5", { force: true });

    expect(report.status).toBe("unreachable");
    expect(report.errors).toContain("connection timeout");
    expect(report.items).toHaveLength(0);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles data with non-ok status", async () => {
    loadClusterEntitiesMock.mockResolvedValueOnce({
      status: "error",
      errors: "forbidden",
    });

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-6", { force: true });

    expect(report.status).toBe("insufficient");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("includes missing resource information", async () => {
    const data = makeClusterData({
      pods: {
        items: [
          makePod("no-limits", "default", {
            qosClass: "Burstable",
            containers: [
              {
                name: "main",
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                },
              },
            ],
          }),
        ],
      },
    });

    const { checkPodQos } = await import("./check-pod-qos");
    const report = await checkPodQos("cluster-7", { force: true, data: data as never });

    expect(report.items[0].missing).toContain("cpu limit");
    expect(report.items[0].missing).toContain("memory limit");
  });

  it("uses cache within 60s", async () => {
    const data = makeClusterData();
    loadClusterEntitiesMock.mockResolvedValue(data);

    const { checkPodQos } = await import("./check-pod-qos");
    await checkPodQos("cluster-8", { data: data as never });
    await checkPodQos("cluster-8");

    expect(loadClusterEntitiesMock).not.toHaveBeenCalled();
  });
});
