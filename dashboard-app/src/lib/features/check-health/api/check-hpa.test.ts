import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { loadClusterEntities } from "./get-cluster-info";
import { checkHpaStatus } from "./check-hpa";
import type { ClusterData } from "$shared/model/clusters";

const mockedKubectl = vi.mocked(kubectlRawFront);
const mockedLoad = vi.mocked(loadClusterEntities);

function makeClusterData(overrides: Partial<ClusterData> = {}): ClusterData {
  return {
    uuid: "cluster-1",
    name: "test",
    status: "ok",
    pods: { items: [] },
    deployments: { items: [] },
    replicasets: { items: [] },
    cronjobs: { items: [] },
    configmaps: { items: [] },
    nodes: { items: [] },
    namespaces: { items: [] },
    daemonsets: { items: [] },
    statefulsets: { items: [] },
    jobs: { items: [] },
    networkpolicies: { items: [] },
    poddisruptionbudgets: { items: [] },
    priorityclasses: { items: [] },
    secrets: { items: [] },
    ...overrides,
  } as ClusterData;
}

describe("checkHpaStatus", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when HPAs are healthy and targets exist", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          {
            metadata: { name: "web-app", namespace: "default" },
            spec: { replicas: 3 },
          },
        ],
      } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: { name: "web-app-hpa", namespace: "default" },
            spec: {
              minReplicas: 2,
              maxReplicas: 10,
              scaleTargetRef: { kind: "Deployment", name: "web-app" },
              metrics: [
                {
                  type: "Resource",
                  resource: {
                    name: "cpu",
                    target: { type: "Utilization", averageUtilization: 80 },
                  },
                },
              ],
            },
            status: {
              currentReplicas: 3,
              desiredReplicas: 3,
              conditions: [
                { type: "ScalingActive", status: "True" },
                { type: "AbleToScale", status: "True" },
              ],
            },
          },
        ],
      }),
      errors: "",
      code: 0,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].hpaName).toBe("web-app-hpa");
    expect(result.items[0].status).toBe("ok");
    expect(result.items[0].scalingActive).toBe(true);
  });

  it("returns critical when HPA scale target does not exist", async () => {
    const data = makeClusterData({
      deployments: { items: [] } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: { name: "orphan-hpa", namespace: "default" },
            spec: {
              minReplicas: 1,
              maxReplicas: 5,
              scaleTargetRef: { kind: "Deployment", name: "missing-deploy" },
              metrics: [{ type: "Resource", resource: { name: "cpu" } }],
            },
            status: {
              currentReplicas: 1,
              desiredReplicas: 1,
              conditions: [],
            },
          },
        ],
      }),
      errors: "",
      code: 0,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items[0].status).toBe("critical");
    expect(result.items[0].reason).toBe("InvalidScaleTargetRef");
  });

  it("returns critical when scaling is inactive", async () => {
    const data = makeClusterData({
      deployments: {
        items: [{ metadata: { name: "web", namespace: "default" }, spec: { replicas: 1 } }],
      } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: { name: "web-hpa", namespace: "default" },
            spec: {
              minReplicas: 1,
              maxReplicas: 5,
              scaleTargetRef: { kind: "Deployment", name: "web" },
              metrics: [{ type: "Resource", resource: { name: "cpu" } }],
            },
            status: {
              currentReplicas: 1,
              desiredReplicas: 1,
              conditions: [
                {
                  type: "ScalingActive",
                  status: "False",
                  reason: "FailedGetResourceMetric",
                  message: "unable to get metrics",
                },
              ],
            },
          },
        ],
      }),
      errors: "",
      code: 0,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items[0].status).toBe("critical");
  });

  it("returns critical for required workloads missing HPA", async () => {
    const data = makeClusterData({
      deployments: {
        items: [
          {
            metadata: {
              name: "important-app",
              namespace: "default",
              labels: { "autoscaling.kubemaster.io/required": "true" },
            },
            spec: { replicas: 2 },
          },
        ],
      } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: JSON.stringify({ items: [] }),
      errors: "",
      code: 0,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].reason).toBe("MissingHpa");
    expect(result.items[0].hpaName).toBe("-");
  });

  it("returns ok with no HPAs and no required workloads", async () => {
    const data = makeClusterData({
      deployments: {
        items: [{ metadata: { name: "simple", namespace: "default" }, spec: { replicas: 1 } }],
      } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: JSON.stringify({ items: [] }),
      errors: "",
      code: 0,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("returns error status when kubectl fails", async () => {
    const data = makeClusterData({
      deployments: { items: [] } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "connection refused",
      code: 1,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkHpaStatus(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns insufficient when error contains forbidden", async () => {
    const data = makeClusterData({
      deployments: { items: [] } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: "",
      errors: "forbidden: User cannot list hpa",
      code: 1,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("insufficient");
  });

  it("returns warning when desired replicas differ from current", async () => {
    const data = makeClusterData({
      deployments: {
        items: [{ metadata: { name: "web", namespace: "default" }, spec: { replicas: 3 } }],
      } as any,
      statefulsets: { items: [] } as any,
    });

    mockedKubectl.mockResolvedValue({
      output: JSON.stringify({
        items: [
          {
            metadata: { name: "web-hpa", namespace: "default" },
            spec: {
              minReplicas: 1,
              maxReplicas: 10,
              scaleTargetRef: { kind: "Deployment", name: "web" },
              metrics: [{ type: "Resource", resource: { name: "cpu" } }],
            },
            status: {
              currentReplicas: 3,
              desiredReplicas: 7,
              conditions: [
                { type: "ScalingActive", status: "True" },
                { type: "AbleToScale", status: "True" },
              ],
            },
          },
        ],
      }),
      errors: "",
      code: 0,
    });

    const result = await checkHpaStatus(clusterId, { force: true, data });

    expect(result.status).toBe("warning");
    expect(result.items[0].reason).toBe("ScalingMismatch");
  });
});
