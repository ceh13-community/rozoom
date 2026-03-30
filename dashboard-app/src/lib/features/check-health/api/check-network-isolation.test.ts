import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { loadClusterEntities } from "./get-cluster-info";
import { checkNetworkIsolation } from "./check-network-isolation";
import type { ClusterData } from "$shared/model/clusters";

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

describe("checkNetworkIsolation", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when namespace has full network policy coverage", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [{ metadata: { name: "production", labels: {} } }],
      } as any,
      networkpolicies: {
        items: [
          {
            metadata: { name: "default-deny", namespace: "production" },
            spec: {
              podSelector: { matchLabels: {} },
              policyTypes: ["Ingress", "Egress"],
            },
          },
          {
            metadata: { name: "allow-ingress", namespace: "production" },
            spec: {
              podSelector: {},
              ingress: [
                { from: [{ namespaceSelector: { matchLabels: { name: "ingress-nginx" } } }] },
              ],
              policyTypes: ["Ingress"],
            },
          },
          {
            metadata: { name: "allow-dns", namespace: "production" },
            spec: {
              podSelector: {},
              egress: [
                {
                  to: [
                    {
                      namespaceSelector: {
                        matchLabels: { "kubernetes.io/metadata.name": "kube-system" },
                      },
                    },
                  ],
                  ports: [{ protocol: "UDP", port: 53 }],
                },
              ],
              policyTypes: ["Egress"],
            },
          },
        ],
      } as any,
      pods: { items: [] },
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].defaultDenyIngress).toBe(true);
    expect(result.items[0].defaultDenyEgress).toBe(true);
    expect(result.items[0].allowIngress).toBe(true);
    expect(result.items[0].allowDns).toBe(true);
  });

  it("returns warning when namespace has no network policies", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [{ metadata: { name: "my-ns", labels: {} } }],
      } as any,
      networkpolicies: { items: [] } as any,
      pods: { items: [] },
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("warning");
    expect(result.items[0].policyCount).toBe(0);
    expect(result.items[0].issues).toContain("No NetworkPolicy in namespace.");
  });

  it("returns critical when critical-labeled namespace has no policies", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [
          {
            metadata: {
              name: "critical-ns",
              labels: { "kubemaster.io/critical": "true" },
            },
          },
        ],
      } as any,
      networkpolicies: { items: [] } as any,
      pods: { items: [] },
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items[0].status).toBe("critical");
  });

  it("returns warning when default deny is missing but policies exist", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [{ metadata: { name: "my-ns", labels: {} } }],
      } as any,
      networkpolicies: {
        items: [
          {
            metadata: { name: "allow-something", namespace: "my-ns" },
            spec: {
              podSelector: { matchLabels: { app: "web" } },
              ingress: [{ from: [{ podSelector: {} }] }],
              policyTypes: ["Ingress"],
            },
          },
        ],
      } as any,
      pods: { items: [] },
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("warning");
    expect(result.items[0].issues).toContain("Default deny policy is missing.");
  });

  it("returns ok with empty namespaces", async () => {
    const data = makeClusterData({
      namespaces: { items: [] } as any,
      networkpolicies: { items: [] } as any,
      pods: { items: [] },
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.items).toHaveLength(0);
  });

  it("returns error status when data loading fails", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "connection refused",
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkNetworkIsolation(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns unsupported when error mentions networkpolicies not found", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "the server doesn't have a resource type networkpolicies",
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("unsupported");
  });

  it("returns insufficient when error contains forbidden", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "forbidden: User cannot list networkpolicies",
    });

    const result = await checkNetworkIsolation(clusterId, { force: true, data });

    expect(result.status).toBe("insufficient");
  });
});
