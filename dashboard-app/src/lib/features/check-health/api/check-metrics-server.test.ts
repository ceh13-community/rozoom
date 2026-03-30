import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkMetricsServer, resetCheckMetricsServerCache } from "./check-metrics-server";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";
import { checkResponseStatus } from "$shared/lib/parsers";
import { resetFeatureCapabilityCache } from "../model/feature-capability-cache";

vi.mock("@/lib/shared/api/kubectl-proxy");
vi.mock("@/lib/shared/lib/parsers");

const mockedKubectlRawFront = vi.mocked(kubectlRawFront);
const mockedCheckResponseStatus = vi.mocked(checkResponseStatus);

describe("checkMetricsServer", () => {
  const clusterId = "test-cluster";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2025-12-11T10:00:00Z")); // фіксуємо дату для передбачуваності
    resetCheckMetricsServerCache();
    resetFeatureCapabilityCache();
  });

  it("should return error status when kubectlRawFront returns errors with Unauthorized/Forbidden", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: "",
        errors: "Unauthorized: access denied",
        code: 1,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" });
    mockedCheckResponseStatus.mockReturnValue(0);

    const result = await checkMetricsServer(clusterId);

    expect(result).toEqual({
      error: "Unauthorized: access denied",
      installed: false,
      lastSync: "2025-12-11T10:00:00.000Z",
      status: [{ result: 0 }],
      title: "Metrics Server",
    });
  });

  it("should return error status for NotFound/404", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: "",
        errors: "Error: nodes.metrics.k8s.io NotFound",
        code: 404,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" });
    mockedCheckResponseStatus.mockReturnValue(-1);

    const result = await checkMetricsServer(clusterId);

    expect(result).toEqual({
      error: "Error: nodes.metrics.k8s.io NotFound",
      installed: false,
      lastSync: "2025-12-11T10:00:00.000Z",
      status: [{ result: -1 }],
      title: "Metrics Server",
    });
  });

  it("should return error status for timeout", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: "",
        errors: "command timed out",
        code: undefined,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        output: "",
        errors: "",
        code: 0,
      })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" });
    mockedCheckResponseStatus.mockReturnValue(2);

    const result = await checkMetricsServer(clusterId);

    expect(result).toEqual({
      error: "command timed out",
      installed: false,
      lastSync: "2025-12-11T10:00:00.000Z",
      status: [{ result: 2 }],
      title: "Metrics Server",
    });
  });

  it("should return success when items exist in response", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }, { metadata: { name: "node-2" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "pod-1" } }, { metadata: { name: "pod-2" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "NAME CPU MEMORY\nnode-1 100m 40%\n",
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }, { metadata: { name: "node-2" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server",
                namespace: "kube-system",
                labels: {
                  "k8s-app": "metrics-server",
                  "app.kubernetes.io/managed-by": "Helm",
                  "app.kubernetes.io/instance": "metrics-server",
                },
              },
              status: {
                replicas: 1,
                readyReplicas: 1,
                availableReplicas: 1,
                updatedReplicas: 1,
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server-abc",
                namespace: "kube-system",
                labels: {
                  "k8s-app": "metrics-server",
                },
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
      });

    const result = await checkMetricsServer(clusterId);

    expect(result).toEqual({
      lastSync: "2025-12-11T10:00:00.000Z",
      installed: true,
      managedBy: "helm",
      namespace: "kube-system",
      releaseName: "metrics-server",
      status: [{ result: 1 }],
      title: "Metrics Server",
      url: "/apis/metrics.k8s.io/v1beta1/nodes + /apis/metrics.k8s.io/v1beta1/pods + kubectl top nodes",
    });
  });

  it("should return unreachable status when metrics endpoints are empty", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "NAME CPU MEMORY\n",
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server",
                namespace: "kube-system",
                labels: { "k8s-app": "metrics-server" },
              },
              status: {
                replicas: 1,
                readyReplicas: 0,
                availableReplicas: 0,
              },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server-abc",
                namespace: "kube-system",
                labels: { "k8s-app": "metrics-server" },
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
      });

    const result = await checkMetricsServer(clusterId);

    expect(result.status).toEqual([{ result: 0 }]);
    expect(result.error).toContain("not Ready");
  });

  it("should handle malformed JSON gracefully (by not crashing)", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: "not valid json",
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({ items: [{ metadata: { name: "pod-1" } }] }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "NAME CPU MEMORY\nnode-1 100m 40%\n",
        errors: "",
      })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" });

    const result = await checkMetricsServer(clusterId);

    expect(result.status).toEqual([{ result: -1 }]);
    expect(result.lastSync).toBe("2025-12-11T10:00:00.000Z");
  });

  it("should pass correct args to kubectlRawFront", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({ output: "{}", errors: "" })
      .mockResolvedValueOnce({ output: "{}", errors: "" })
      .mockResolvedValueOnce({ output: "NAME CPU MEMORY\nnode-1 100m 40%\n", errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" })
      .mockResolvedValueOnce({ output: JSON.stringify({ items: [] }), errors: "" });

    await checkMetricsServer(clusterId);

    expect(mockedKubectlRawFront).toHaveBeenCalledWith(
      "get --raw /apis/metrics.k8s.io/v1beta1/nodes",
      { clusterId },
    );
    expect(mockedKubectlRawFront).toHaveBeenCalledWith(
      "get --raw /apis/metrics.k8s.io/v1beta1/pods",
      {
        clusterId,
      },
    );
    expect(mockedKubectlRawFront).toHaveBeenCalledWith("top nodes", { clusterId });
    expect(mockedKubectlRawFront).toHaveBeenCalledWith("get nodes -o json", { clusterId });
    expect(mockedKubectlRawFront).toHaveBeenCalledWith("get deployment -A -o json", { clusterId });
    expect(mockedKubectlRawFront).toHaveBeenCalledWith("get pod -A -o json", { clusterId });
  });

  it("returns unreachable when metrics-server reports only subset of cluster nodes", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "pod-1" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "NAME CPU MEMORY\nnode-1 100m 40%\n",
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }, { metadata: { name: "node-2" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server",
                namespace: "kube-system",
                labels: { "k8s-app": "metrics-server" },
              },
              status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server-abc",
                namespace: "kube-system",
                labels: { "k8s-app": "metrics-server" },
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
      });

    const result = await checkMetricsServer(clusterId);
    expect(result.status).toEqual([{ result: 0 }]);
    expect(result.error).toContain("reports 1/2 nodes");
  });

  it("returns available when metrics data is ready even with transient scrape issues", async () => {
    mockedKubectlRawFront
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "pod-1" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: "NAME CPU MEMORY\nnode-1 100m 40%\n",
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [{ metadata: { name: "node-1" } }],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server",
                namespace: "kube-system",
                labels: { "k8s-app": "metrics-server" },
              },
              status: { replicas: 1, readyReplicas: 1, availableReplicas: 1 },
            },
          ],
        }),
        errors: "",
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          items: [
            {
              metadata: {
                name: "metrics-server-abc",
                namespace: "kube-system",
                labels: { "k8s-app": "metrics-server" },
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
      });

    const result = await checkMetricsServer(clusterId);

    expect(result.status).toEqual([{ result: 1 }]);
    expect(result.error).toBeUndefined();
  });
});
