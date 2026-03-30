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
    deployments: { items: [] },
    statefulsets: { items: [] },
    daemonsets: { items: [] },
    priorityclasses: { items: [] },
    ...overrides,
  };
}

function makeDeployment(
  name: string,
  namespace: string,
  priorityClassName?: string,
  labels?: Record<string, string>,
) {
  return {
    metadata: { name, namespace, labels },
    spec: {
      template: { spec: { priorityClassName } },
    },
  };
}

function makeStatefulSet(
  name: string,
  namespace: string,
  priorityClassName?: string,
  labels?: Record<string, string>,
) {
  return {
    metadata: { name, namespace, labels },
    spec: {
      template: { spec: { priorityClassName } },
    },
  };
}

function makeDaemonSet(
  name: string,
  namespace: string,
  priorityClassName?: string,
  labels?: Record<string, string>,
) {
  return {
    metadata: { name, namespace, labels },
    spec: {
      template: { spec: { priorityClassName } },
    },
  };
}

function makePriorityClass(
  name: string,
  value: number,
  opts: { preemptionPolicy?: string; globalDefault?: boolean } = {},
) {
  return {
    metadata: { name },
    value,
    preemptionPolicy: opts.preemptionPolicy,
    globalDefault: opts.globalDefault,
  };
}

describe("check-priority", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    loadClusterEntitiesMock.mockReset();
    logErrorMock.mockReset();
  });

  it("returns ok when workloads have proper priority classes", async () => {
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("web", "default", "normal")],
      },
      priorityclasses: {
        items: [makePriorityClass("normal", 1000)],
      },
    });

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-1", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items.length).toBeGreaterThanOrEqual(1);
    const workloadItem = report.items.find((i: { workload: string }) => i.workload === "web");
    expect(workloadItem?.status).toBe("ok");
  });

  it("reports critical when critical workload is missing priorityClassName", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("critical-app", "default", undefined, {
            "kubemaster.io/critical": "true",
          }),
        ],
      },
    });

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-2", { force: true, data: data as never });

    expect(report.status).toBe("critical");
    const item = report.items.find((i: { workload: string }) => i.workload === "critical-app");
    expect(item?.issues).toContain("Critical workload missing priorityClassName.");
  });

  it("warns about stateful workload using PreemptLowerPriority", async () => {
    const data = makeClusterData({
      statefulsets: {
        items: [makeStatefulSet("db", "default", "high-priority")],
      },
      priorityclasses: {
        items: [
          makePriorityClass("high-priority", 50000, { preemptionPolicy: "PreemptLowerPriority" }),
        ],
      },
    });

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-3", { force: true, data: data as never });

    const item = report.items.find((i: { workload: string }) => i.workload === "db");
    expect(item?.issues).toContain("Stateful workload uses PreemptLowerPriority preemption.");
  });

  it("warns about unused priority classes", async () => {
    const data = makeClusterData({
      priorityclasses: {
        items: [makePriorityClass("unused-pc", 5000)],
      },
    });

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-4", { force: true, data: data as never });

    const unused = report.items.find((i: { workload: string }) => i.workload === "unused-pc");
    expect(unused).toBeDefined();
    expect(unused?.issues).toContain("PriorityClass is not referenced by any workload.");
  });

  it("returns ok with empty workloads and no priority classes", async () => {
    const data = makeClusterData();

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-5", { force: true, data: data as never });

    expect(report.status).toBe("ok");
    expect(report.items).toHaveLength(0);
  });

  it("handles loadClusterEntities error gracefully", async () => {
    loadClusterEntitiesMock.mockRejectedValueOnce(new Error("connection refused"));

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-6", { force: true });

    expect(report.status).toBe("unreachable");
    expect(report.errors).toContain("connection refused");
    expect(report.items).toHaveLength(0);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("handles data with non-ok status", async () => {
    loadClusterEntitiesMock.mockResolvedValueOnce({
      status: "error",
      errors: "unauthorized",
    });

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-7", { force: true });

    expect(report.status).toBe("insufficient");
    expect(logErrorMock).toHaveBeenCalled();
  });

  it("warns about high priority on non-critical workload", async () => {
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("regular-app", "default", "too-high")],
      },
      priorityclasses: {
        items: [makePriorityClass("too-high", 200000)],
      },
    });

    const { checkPriorityStatus } = await import("./check-priority");
    const report = await checkPriorityStatus("cluster-8", { force: true, data: data as never });

    const item = report.items.find((i: { workload: string }) => i.workload === "regular-app");
    expect(item?.issues).toContain("High priority used on a non-critical workload.");
  });

  it("uses cache within 60s", async () => {
    const data = makeClusterData();
    loadClusterEntitiesMock.mockResolvedValue(data);

    const { checkPriorityStatus } = await import("./check-priority");
    await checkPriorityStatus("cluster-9", { data: data as never });
    await checkPriorityStatus("cluster-9");

    expect(loadClusterEntitiesMock).not.toHaveBeenCalled();
  });
});
