import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
}));

vi.mock("./get-cluster-info", () => ({
  loadClusterEntities: vi.fn(),
}));

import { loadClusterEntities } from "./get-cluster-info";
import { checkPodSecurity } from "./check-pod-security";
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

describe("checkPodSecurity", () => {
  const clusterId = "cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok when namespaces have restricted PSA and pods comply", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [
          {
            metadata: {
              name: "production",
              labels: {
                "pod-security.kubernetes.io/enforce": "restricted",
                "pod-security.kubernetes.io/warn": "restricted",
                "pod-security.kubernetes.io/audit": "restricted",
              },
            },
          },
        ],
      } as any,
      pods: {
        items: [
          {
            metadata: { name: "pod-1", namespace: "production" },
            spec: {
              containers: [
                {
                  name: "app",
                  securityContext: {
                    runAsNonRoot: true,
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: true,
                    capabilities: { drop: ["ALL"] },
                  },
                },
              ],
            },
          },
        ],
      } as any,
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.namespaces).toHaveLength(1);
    expect(result.namespaces[0].enforce).toBe("restricted");
    expect(result.items).toHaveLength(0);
  });

  it("returns critical when namespace has no PSA enforce label", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [
          {
            metadata: { name: "my-ns", labels: {} },
          },
        ],
      } as any,
      pods: { items: [] },
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.status).toBe("warning");
    expect(result.namespaces[0].status).toBe("critical");
    expect(result.namespaces[0].enforce).toBe("unset");
    expect(result.namespaces[0].issues.length).toBeGreaterThan(0);
  });

  it("returns critical when namespace enforces privileged (non-system)", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [
          {
            metadata: {
              name: "my-ns",
              labels: {
                "pod-security.kubernetes.io/enforce": "privileged",
                "pod-security.kubernetes.io/warn": "privileged",
                "pod-security.kubernetes.io/audit": "privileged",
              },
            },
          },
        ],
      } as any,
      pods: { items: [] },
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.namespaces[0].status).toBe("critical");
    expect(result.namespaces[0].issues).toContain("Namespace enforces privileged policy.");
  });

  it("returns violations for pods missing security context in restricted namespace", async () => {
    const data = makeClusterData({
      namespaces: {
        items: [
          {
            metadata: {
              name: "production",
              labels: {
                "pod-security.kubernetes.io/enforce": "restricted",
                "pod-security.kubernetes.io/warn": "restricted",
                "pod-security.kubernetes.io/audit": "restricted",
              },
            },
          },
        ],
      } as any,
      pods: {
        items: [
          {
            metadata: { name: "bad-pod", namespace: "production" },
            spec: {
              containers: [
                {
                  name: "app",
                  securityContext: {},
                },
              ],
            },
          },
        ],
      } as any,
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.status).toBe("critical");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].pod).toBe("bad-pod");
    expect(result.items[0].status).toBe("critical");
    expect(result.items[0].issues.length).toBeGreaterThan(0);
  });

  it("returns ok with empty namespaces and pods", async () => {
    const data = makeClusterData({
      namespaces: { items: [] } as any,
      pods: { items: [] },
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.status).toBe("ok");
    expect(result.namespaces).toHaveLength(0);
    expect(result.items).toHaveLength(0);
  });

  it("returns error status when data loading fails", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "connection refused",
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.status).toBe("unreachable");
    expect(result.errors).toBeDefined();
  });

  it("returns unknown on thrown error", async () => {
    mockedLoad.mockRejectedValue(new Error("network failure"));

    const result = await checkPodSecurity(clusterId, { force: true });

    expect(result.status).toBe("unknown");
    expect(result.errors).toBeDefined();
  });

  it("returns insufficient when error contains forbidden", async () => {
    const data = makeClusterData({
      status: "error",
      errors: "forbidden: User cannot list pods",
    });

    const result = await checkPodSecurity(clusterId, { force: true, data });

    expect(result.status).toBe("insufficient");
  });
});
