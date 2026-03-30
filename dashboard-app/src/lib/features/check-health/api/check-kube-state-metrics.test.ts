import { vi, describe, it, expect, beforeEach } from "vitest";
import { checkKubeStateMetrics } from "./check-kube-state-metrics";

vi.mock("@/lib/shared/api/kubectl-proxy", () => ({
  kubectlRawFront: vi.fn(),
}));

vi.mock("@/lib/shared/lib/parsers", () => ({
  checkResponseStatus: vi.fn(),
}));

import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkResponseStatus } from "$shared/lib/parsers";
import { resetFeatureCapabilityCache } from "../model/feature-capability-cache";

const mockedStatus = vi.mocked(checkResponseStatus);
const mockedKubectl = vi.mocked(kubectlRawFront);

describe("checkKubeStateMetrics", () => {
  const clusterId = "test-cluster";

  beforeEach(() => {
    vi.clearAllMocks();
    resetFeatureCapabilityCache();
  });

  it("should return error if kubectl has stderr", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        output: "",
        errors: "some kubectl error",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
      });
    mockedStatus.mockReturnValue(-1);

    const result = await checkKubeStateMetrics(clusterId);

    expect(result).toMatchObject({
      error: "some kubectl error",
      status: [{ result: -1 }],
      title: "Kube State Metrics",
    });
    expect(checkResponseStatus).toHaveBeenCalledWith("some kubectl error");
  });

  it("should cover the case when kube-state-metrics not found", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ kind: "DeploymentList", items: [] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);

    expect(result).toMatchObject({
      error: "Cluster has no kube-state-metrics deployment",
      installed: false,
      status: [{ result: -1 }],
    });
  });

  it("should return success, if readyReplicas > 0", async () => {
    const deployment = {
      metadata: {
        name: "kube-state-metrics",
        namespace: "kube-system",
        labels: {
          "app.kubernetes.io/name": "kube-state-metrics",
          "app.kubernetes.io/managed-by": "Helm",
          "app.kubernetes.io/instance": "kps",
        },
      },
      status: {
        replicas: 1,
        readyReplicas: 1,
        availableReplicas: 1,
        updatedReplicas: 1,
      },
    };

    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ kind: "DeploymentList", items: [deployment] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "kube-system",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "ok",
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);

    expect(result).toMatchObject({
      installed: true,
      managedBy: "helm",
      namespace: "kube-system",
      releaseName: "kps",
      status: [{ result: 1 }],
      url: expect.stringContaining("kube-system"),
    });
  });

  it("should return valid url in result (points to /metrics for detail view)", async () => {
    const deployment = {
      metadata: {
        name: "kube-state-metrics",
        namespace: "monitoring",
        labels: { "app.kubernetes.io/name": "kube-state-metrics" },
      },
      status: {
        replicas: 2,
        readyReplicas: 2,
        availableReplicas: 2,
        updatedReplicas: 2,
      },
    };

    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [deployment] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "monitoring",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "ok",
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);

    expect(result.url).toBeDefined();
    expect(result.url ?? "").toContain("kube-state-metrics:8080");
  });

  it("should handle invalid JSON shape as not found", async () => {
    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ kind: "Status", message: "error" }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);
    expect(result.installed).toBe(false);
  });

  it("should return unreachable if deployment or pod is not ready", async () => {
    const deploymentNoReady = {
      metadata: {
        name: "kube-state-metrics",
        namespace: "kube-system",
        labels: { "app.kubernetes.io/name": "kube-state-metrics" },
      },
      status: { readyReplicas: 0 },
    };

    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [deploymentNoReady] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "kube-system",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Pending",
                conditions: [{ type: "Ready", status: "False" }],
                containerStatuses: [{ ready: false }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "ok",
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);

    expect(result.status).toEqual([{ result: 0 }]);
  });

  it("should find deployment if there are multiple with the same label", async () => {
    const items = [
      {
        metadata: {
          name: "other",
          labels: { "app.kubernetes.io/name": "other" },
        },
      },
      {
        metadata: {
          name: "kube-state-metrics",
          namespace: "kube-system",
          labels: { "app.kubernetes.io/name": "kube-state-metrics" },
        },
        status: {
          replicas: 1,
          readyReplicas: 1,
          availableReplicas: 1,
          updatedReplicas: 1,
        },
      },
    ];

    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ items }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "kube-system",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "ok",
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);

    expect(result.status).toEqual([{ result: 1 }]);
  });

  it("should return unhealthy when healthz endpoint returns unexpected response", async () => {
    const deployment = {
      metadata: {
        name: "kube-state-metrics",
        namespace: "kube-system",
        labels: { "app.kubernetes.io/name": "kube-state-metrics" },
      },
      status: {
        replicas: 1,
        readyReplicas: 1,
        availableReplicas: 1,
      },
    };

    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [deployment] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "kube-system",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "not healthy",
        errors: "",
      });

    const result = await checkKubeStateMetrics(clusterId);
    expect(result.status).toEqual([{ result: 0 }]);
    expect(result.error).toContain("healthz endpoint returned unhealthy status");
  });

  it("should return endpoint error status when proxy call fails", async () => {
    const deployment = {
      metadata: {
        name: "kube-state-metrics",
        namespace: "kube-system",
        labels: { "app.kubernetes.io/name": "kube-state-metrics" },
      },
      status: {
        replicas: 1,
        readyReplicas: 1,
        availableReplicas: 1,
      },
    };
    mockedStatus.mockReturnValueOnce(0);
    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [deployment] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "kube-system",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "Forbidden",
      });

    const result = await checkKubeStateMetrics(clusterId);
    expect(result.status).toEqual([{ result: 0 }]);
    expect(result.error).toBe("Forbidden");
  });

  it("should skip repeated endpoint probes after a cached probe failure", async () => {
    const deployment = {
      metadata: {
        name: "kube-state-metrics",
        namespace: "kube-system",
        labels: { "app.kubernetes.io/name": "kube-state-metrics" },
      },
      status: {
        replicas: 1,
        readyReplicas: 1,
        availableReplicas: 1,
      },
    };

    mockedStatus.mockReturnValue(0);
    mockedKubectl
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [deployment] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "kube-state-metrics-abc",
                namespace: "kube-system",
                labels: { "app.kubernetes.io/name": "kube-state-metrics" },
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [{ ready: true }],
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "context deadline exceeded",
      });

    const first = await checkKubeStateMetrics(clusterId);
    const second = await checkKubeStateMetrics(clusterId);

    expect(first.error).toBe("context deadline exceeded");
    expect(second.error).toBe("context deadline exceeded");
    expect(mockedKubectl).toHaveBeenCalledTimes(3);
  });
});
