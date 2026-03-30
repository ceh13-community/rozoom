import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { loadClusterEntities } from "./get-cluster-info";
import { checkResourcesHygiene } from "./check-resources-hygiene";

const mockedLoad = vi.mocked(loadClusterEntities);

function makeClusterData(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok" as const,
    errors: undefined,
    deployments: { items: [] },
    statefulsets: { items: [] },
    daemonsets: { items: [] },
    jobs: { items: [] },
    cronjobs: { items: [] },
    ...overrides,
  };
}

function makeDeployment(name: string, namespace: string, containers: unknown[]) {
  return {
    metadata: { name, namespace },
    spec: {
      template: {
        spec: { containers },
      },
    },
  };
}

describe("checkResourcesHygiene", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when all workloads have full resource specs", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("app", "default", [
            {
              name: "main",
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "100m", memory: "128Mi" },
              },
            },
          ]),
        ],
      },
    });

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("ok");
    expect(result.summary.total).toBe(1);
    expect(result.summary.ok).toBe(1);
    expect(result.summary.warning).toBe(0);
    expect(result.summary.critical).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("returns critical when containers have no resources (BestEffort)", async () => {
    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("app", "default", [{ name: "main", resources: {} }])],
      },
    });

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("critical");
    expect(result.summary.critical).toBe(1);
    expect(result.summary.bestEffort).toBe(1);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].qosClass).toBe("BestEffort");
  });

  it("returns warning when memory limit is missing", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          makeDeployment("app", "default", [
            {
              name: "main",
              resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "200m" },
              },
            },
          ]),
        ],
      },
    });

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("warning");
    expect(result.summary.warning).toBe(1);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].missing).toContain("memory limit");
  });

  it("returns ok with empty workloads", async () => {
    const data = makeClusterData();

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("ok");
    expect(result.summary.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("returns error status when data loading fails", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "connection refused",
    });

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error from loadClusterEntities", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkResourcesHygiene(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns insufficient on forbidden error", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "forbidden: User cannot list resources",
    });

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("insufficient");
  });

  it("processes multiple workload types", async () => {
    const container = {
      name: "main",
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "100m", memory: "128Mi" },
      },
    };

    const data = makeClusterData({
      deployments: {
        items: [makeDeployment("deploy-1", "ns-a", [container])],
      },
      statefulsets: {
        items: [
          {
            metadata: { name: "sts-1", namespace: "ns-b" },
            spec: { template: { spec: { containers: [container] } } },
          },
        ],
      },
      daemonsets: {
        items: [
          {
            metadata: { name: "ds-1", namespace: "ns-c" },
            spec: { template: { spec: { containers: [container] } } },
          },
        ],
      },
    });

    const result = await checkResourcesHygiene(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.summary.total).toBe(3);
    expect(result.summary.ok).toBe(3);
    expect(result.workloads).toHaveLength(3);
  });
});
