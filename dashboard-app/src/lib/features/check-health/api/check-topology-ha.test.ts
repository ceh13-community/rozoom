import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { loadClusterEntities } from "./get-cluster-info";
import { checkTopologyHa } from "./check-topology-ha";

const mockedLoad = vi.mocked(loadClusterEntities);

function makeClusterData(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok" as const,
    errors: undefined,
    deployments: { items: [] },
    statefulsets: { items: [] },
    pods: { items: [] },
    nodes: { items: [] },
    ...overrides,
  };
}

function makeNode(name: string, zone?: string) {
  const labels: Record<string, string> = {};
  if (zone) labels["topology.kubernetes.io/zone"] = zone;
  return { metadata: { name, labels } };
}

function makePod(
  name: string,
  namespace: string,
  labels: Record<string, string>,
  nodeName?: string,
) {
  return {
    metadata: { name, namespace, labels },
    spec: { nodeName },
  };
}

function makeDeployment(
  name: string,
  namespace: string,
  replicas: number,
  matchLabels: Record<string, string>,
  podSpec: Record<string, unknown> = {},
) {
  return {
    metadata: { name, namespace },
    spec: {
      replicas,
      selector: { matchLabels },
      template: { spec: podSpec },
    },
  };
}

describe("checkTopologyHa", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok for single-replica workloads (HA not required)", async () => {
    const data = makeClusterData({
      nodes: { items: [makeNode("node-1", "us-east-1a")] },
      deployments: {
        items: [makeDeployment("app", "default", 1, { app: "web" })],
      },
      pods: {
        items: [makePod("app-abc", "default", { app: "web" }, "node-1")],
      },
    });

    const result = await checkTopologyHa(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].hints).toContain("Replicas < 2; HA spread is not required.");
  });

  it("returns critical when multi-replica workload has no spread constraints and pods on single node", async () => {
    const data = makeClusterData({
      nodes: {
        items: [makeNode("node-1", "us-east-1a"), makeNode("node-2", "us-east-1b")],
      },
      deployments: {
        items: [makeDeployment("app", "default", 3, { app: "web" })],
      },
      pods: {
        items: [
          makePod("app-1", "default", { app: "web" }, "node-1"),
          makePod("app-2", "default", { app: "web" }, "node-1"),
          makePod("app-3", "default", { app: "web" }, "node-1"),
        ],
      },
    });

    const result = await checkTopologyHa(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("critical");
    expect(result.items[0].issues.length).toBeGreaterThan(0);
  });

  it("returns ok when workload has topology spread constraints and pods spread across nodes/zones", async () => {
    const data = makeClusterData({
      nodes: {
        items: [makeNode("node-1", "us-east-1a"), makeNode("node-2", "us-east-1b")],
      },
      deployments: {
        items: [
          makeDeployment(
            "app",
            "default",
            2,
            { app: "web" },
            {
              topologySpreadConstraints: [
                {
                  maxSkew: 1,
                  topologyKey: "topology.kubernetes.io/zone",
                  whenUnsatisfiable: "DoNotSchedule",
                },
              ],
            },
          ),
        ],
      },
      pods: {
        items: [
          makePod("app-1", "default", { app: "web" }, "node-1"),
          makePod("app-2", "default", { app: "web" }, "node-2"),
        ],
      },
    });

    const result = await checkTopologyHa(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("ok");
    expect(result.items[0].strategy.hasTopologySpreadConstraints).toBe(true);
  });

  it("returns ok with empty workloads", async () => {
    const data = makeClusterData({
      nodes: { items: [makeNode("node-1", "us-east-1a")] },
    });

    const result = await checkTopologyHa(clusterId, {
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

    const result = await checkTopologyHa(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkTopologyHa(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns insufficient on forbidden error", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "forbidden: cannot list pods",
    });

    const result = await checkTopologyHa(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.status).toBe("insufficient");
  });

  it("warns when ScheduleAnyway is used", async () => {
    const data = makeClusterData({
      nodes: {
        items: [makeNode("node-1", "us-east-1a"), makeNode("node-2", "us-east-1b")],
      },
      deployments: {
        items: [
          makeDeployment(
            "app",
            "default",
            2,
            { app: "web" },
            {
              topologySpreadConstraints: [
                {
                  maxSkew: 1,
                  topologyKey: "topology.kubernetes.io/zone",
                  whenUnsatisfiable: "ScheduleAnyway",
                },
              ],
            },
          ),
        ],
      },
      pods: {
        items: [
          makePod("app-1", "default", { app: "web" }, "node-1"),
          makePod("app-2", "default", { app: "web" }, "node-2"),
        ],
      },
    });

    const result = await checkTopologyHa(clusterId, {
      force: true,
      data: data as never,
    });

    expect(result.items[0].issues).toContain("topologySpreadConstraints uses ScheduleAnyway.");
  });
});
