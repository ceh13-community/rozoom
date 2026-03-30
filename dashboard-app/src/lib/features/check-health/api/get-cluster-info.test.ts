import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadClusterData,
  loadClusterEntities,
  loadClusterDataExcept,
  loadClusterMinimal,
  // loadClusterDataResilient,
} from "./get-cluster-info";
import {
  getClusterEntityInfo,
  getClusterFastDashboardEntities,
  getClusterSlowDashboardEntities,
} from "$shared/api/tauri";
import {
  getFeatureCapability,
  resetFeatureCapabilityCache,
} from "../model/feature-capability-cache";

vi.mock("@/lib/shared/api/tauri", () => ({
  getClusterEntityInfo: vi.fn(),
  getClusterFastDashboardEntities: vi.fn(),
  getClusterSlowDashboardEntities: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
}));

const mockPodData = { items: [{ metadata: { namespace: "default", name: "pod-1" } }] };
const mockNodeData = { items: [{ metadata: { name: "node-1" } }] };
const mockNamespaceData = { items: [{ metadata: { name: "default" } }] };

const successResponse = <E extends string>(entity: E, data: any) => ({
  data,
  status: "ok" as const,
  entity,
});

const errorResponse = <E extends string>(entity: E, errorMsg: string) => ({
  data: errorMsg,
  status: "error" as const,
  entity,
  error: errorMsg,
});

function expectEntityProbe(entity: string, clusterId: string) {
  expect(getClusterEntityInfo).toHaveBeenCalledWith(entity, clusterId, undefined, undefined, {
    lightweight: false,
  });
}

describe("get-cluster-info", () => {
  const cluster = { uuid: "cluster-123", name: "test-cluster" };

  beforeEach(() => {
    vi.mocked(getClusterEntityInfo).mockClear();
    vi.mocked(getClusterFastDashboardEntities).mockClear();
    vi.mocked(getClusterSlowDashboardEntities).mockClear();
    resetFeatureCapabilityCache();
  });

  describe("loadClusterData", () => {
    it("should return cluster data, include test entity (nodes)", async () => {
      vi.mocked(getClusterEntityInfo)
        .mockResolvedValueOnce(successResponse("nodes", mockNodeData))
        .mockResolvedValueOnce(successResponse("pods", mockPodData))
        .mockResolvedValueOnce(successResponse("deployments", { items: [] }))
        .mockResolvedValueOnce(successResponse("replicasets", { items: [] }))
        .mockResolvedValueOnce(successResponse("cronjobs", { items: [] }))
        .mockResolvedValueOnce(successResponse("namespaces", mockNamespaceData));

      const result = await loadClusterData(cluster);

      expect(result.uuid).toBe(cluster.uuid);
      expect(result.name).toBe(cluster.name);
      expect(result.status).toBe("ok");
      expect(result.offline).toBe(false);
      expect(result.nodes).toBe(mockNodeData);
      expect(result.pods).toBe(mockPodData);
      expect(result.namespaces).toBe(mockNamespaceData);
      expect(result.deployments?.items).toHaveLength(0);
      expect(result.cronjobs?.items).toHaveLength(0);
      expect(result.replicasets?.items).toHaveLength(0);
    });

    it("returns error and offline=true if failFast=true and test request error", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValue(
        errorResponse("nodes", "Failed to connect"),
      );

      const result = await loadClusterData(cluster);

      expect(result.status).toBe("error");
      expect(result.offline).toBe(true);
      expect(result.errors).toBe("Failed to connect");
      expect(result.pods.items).toHaveLength(0);
      expect(result.nodes.items).toHaveLength(0);
      expect(
        getFeatureCapability(
          cluster.uuid,
          "entity-probe:cronjobs,deployments,namespaces,pods,replicasets",
        ),
      ).toEqual(expect.objectContaining({ status: "unreachable", reason: "Failed to connect" }));
    });

    // it("should continue loading if test request fails and failFast=false", async () => {
    //   vi.mocked(getClusterEntityInfo)
    //     .mockResolvedValueOnce(errorResponse("nodes", "Node access denied"))
    //     .mockResolvedValueOnce(successResponse("pods", mockPodData))
    //     .mockResolvedValueOnce(successResponse("namespaces", mockNamespaceData));

    //   const result = await loadClusterData(cluster, { failFast: false });

    //   expect(result.status).toBe("error");
    //   expect(result.offline).toBe(false);
    //   expect(result.errors).toContain("Node access denied");
    //   expect(result.pods).toBe(mockPodData);
    //   expect(result.namespaces).toBe(mockNamespaceData);
    //   expect(result.nodes).toEqual({ items: [] });
    // });

    it("should exclude entities", async () => {
      vi.mocked(getClusterEntityInfo)
        .mockResolvedValueOnce(successResponse("nodes", mockNodeData))
        .mockResolvedValueOnce(successResponse("pods", mockPodData));

      const result = await loadClusterData(cluster, {
        exclude: ["deployments", "replicasets", "cronjobs", "namespaces"],
      });

      expectEntityProbe("nodes", cluster.uuid);
      expectEntityProbe("pods", cluster.uuid);
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith("deployments", expect.anything());
      expect(result.pods).toBe(mockPodData);
      expect(result.nodes).toBe(mockNodeData);
      expect(result.namespaces).toEqual({ items: [] });
    });

    it("should use entities array if provided", async () => {
      vi.mocked(getClusterEntityInfo)
        .mockResolvedValueOnce(successResponse("nodes", mockNodeData)) // test
        .mockResolvedValueOnce(successResponse("pods", mockPodData))
        .mockResolvedValueOnce(successResponse("cronjobs", { items: [{ name: "job" }] }));

      const result = await loadClusterData(cluster, {
        entities: ["pods", "cronjobs"],
      });

      expectEntityProbe("pods", cluster.uuid);
      expectEntityProbe("cronjobs", cluster.uuid);
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith("deployments", expect.anything());
      expect(result.pods).toBe(mockPodData);
      expect(result.cronjobs?.items[0]).toHaveProperty("name", "job");
      expect(result.deployments).toEqual({ items: [] });
    });

    // it("should pass an error in one entity - setd error status and continue load", async () => {
    //   vi.mocked(getClusterEntityInfo)
    //     .mockResolvedValueOnce(successResponse("nodes", mockNodeData))
    //     .mockResolvedValueOnce(successResponse("pods", mockPodData))
    //     .mockRejectedValueOnce(new Error("Timeout"));

    //   const result = await loadClusterData(cluster, { entities: ["pods", "deployments"] });

    //   expect(result.status).toBe("error");
    //   expect(result.errors).toContain("Timeout");
    //   expect(result.pods).toBe(mockPodData);
    //   expect(result.deployments).toEqual({ items: [] });
    // });
  });

  describe("useful functions", () => {
    it("loadClusterEntities - loads only specific entities", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValue(successResponse("pods", mockPodData));

      await loadClusterEntities(cluster, ["pods"]);

      expectEntityProbe("nodes", cluster.uuid);
      expectEntityProbe("pods", cluster.uuid);
    });

    it("loadClusterEntities accepts loader config with signal", async () => {
      const signal = new AbortController().signal;
      vi.mocked(getClusterEntityInfo)
        .mockResolvedValueOnce(successResponse("nodes", mockNodeData))
        .mockResolvedValueOnce(successResponse("pods", mockPodData));

      await loadClusterEntities(cluster, { entities: ["pods"], signal });

      expect(getClusterEntityInfo).toHaveBeenNthCalledWith(
        1,
        "nodes",
        cluster.uuid,
        undefined,
        signal,
        { lightweight: false },
      );
      expect(getClusterEntityInfo).toHaveBeenNthCalledWith(
        2,
        "pods",
        cluster.uuid,
        undefined,
        signal,
        { lightweight: false },
      );
    });

    it("uses the combined fast dashboard query for lightweight workload entities", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValueOnce(successResponse("nodes", mockNodeData));
      vi.mocked(getClusterFastDashboardEntities).mockResolvedValueOnce({
        pods: mockPodData,
        deployments: { items: [{ metadata: { namespace: "default", name: "deploy-1" } }] },
        replicasets: { items: [{ metadata: { namespace: "default", name: "rs-1" } }] },
      });

      const result = await loadClusterEntities(cluster, {
        entities: ["pods", "deployments", "replicasets"],
        lightweight: true,
      });

      expect(getClusterEntityInfo).toHaveBeenCalledTimes(1);
      expect(getClusterEntityInfo).toHaveBeenCalledWith(
        "nodes",
        cluster.uuid,
        undefined,
        undefined,
        { lightweight: true },
      );
      expect(getClusterFastDashboardEntities).toHaveBeenCalledWith(cluster.uuid, undefined);
      expect(result.pods).toBe(mockPodData);
      expect(result.deployments?.items[0]).toEqual({
        metadata: { namespace: "default", name: "deploy-1" },
      });
      expect(result.replicasets?.items[0]).toEqual({
        metadata: { namespace: "default", name: "rs-1" },
      });
    });

    it("keeps the combined fast dashboard query when pods are used as the test entity", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValueOnce(
        successResponse("namespaces", mockNamespaceData),
      );
      vi.mocked(getClusterFastDashboardEntities).mockResolvedValueOnce({
        pods: mockPodData,
        deployments: { items: [{ metadata: { namespace: "default", name: "deploy-1" } }] },
        replicasets: { items: [{ metadata: { namespace: "default", name: "rs-1" } }] },
      });
      vi.mocked(getClusterSlowDashboardEntities).mockResolvedValueOnce({
        daemonsets: { items: [] },
        statefulsets: { items: [] },
        jobs: { items: [] },
        cronjobs: { items: [] },
      });

      const result = await loadClusterData(cluster, {
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
      });

      expect(getClusterFastDashboardEntities).toHaveBeenCalledWith(cluster.uuid, undefined);
      expect(getClusterSlowDashboardEntities).toHaveBeenCalledWith(cluster.uuid, undefined);
      expect(getClusterEntityInfo).toHaveBeenCalledTimes(1);
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith(
        "pods",
        cluster.uuid,
        undefined,
        undefined,
        { lightweight: true },
      );
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith(
        "deployments",
        cluster.uuid,
        undefined,
        undefined,
        { lightweight: true },
      );
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith(
        "replicasets",
        cluster.uuid,
        undefined,
        undefined,
        { lightweight: true },
      );
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith(
        "daemonsets",
        cluster.uuid,
        undefined,
        undefined,
        { lightweight: true },
      );
      expect(result.pods).toBe(mockPodData);
      expect(result.deployments?.items[0]).toEqual({
        metadata: { namespace: "default", name: "deploy-1" },
      });
      expect(result.replicasets?.items[0]).toEqual({
        metadata: { namespace: "default", name: "rs-1" },
      });
      expect(result.namespaces).toBe(mockNamespaceData);
    });

    it("uses the combined slow dashboard query for lightweight slow entities", async () => {
      const mockSlowEntities = {
        daemonsets: { items: [{ metadata: { namespace: "kube-system", name: "fluentd" } }] },
        statefulsets: { items: [{ metadata: { namespace: "default", name: "postgres" } }] },
        jobs: { items: [{ metadata: { namespace: "default", name: "migration" } }] },
        cronjobs: { items: [{ metadata: { namespace: "default", name: "backup" } }] },
      };
      vi.mocked(getClusterEntityInfo).mockResolvedValueOnce(successResponse("nodes", mockNodeData));
      vi.mocked(getClusterSlowDashboardEntities).mockResolvedValueOnce(mockSlowEntities);

      const result = await loadClusterEntities(cluster, {
        entities: ["daemonsets", "statefulsets", "jobs", "cronjobs"],
        lightweight: true,
      });

      expect(getClusterSlowDashboardEntities).toHaveBeenCalledWith(cluster.uuid, undefined);
      expect(getClusterEntityInfo).toHaveBeenCalledTimes(1);
      expect(getClusterEntityInfo).toHaveBeenCalledWith(
        "nodes",
        cluster.uuid,
        undefined,
        undefined,
        { lightweight: true },
      );
      expect(result.daemonsets?.items[0]).toEqual({
        metadata: { namespace: "kube-system", name: "fluentd" },
      });
      expect(result.statefulsets?.items[0]).toEqual({
        metadata: { namespace: "default", name: "postgres" },
      });
      expect(result.jobs?.items[0]).toEqual({
        metadata: { namespace: "default", name: "migration" },
      });
      expect(result.cronjobs?.items[0]).toEqual({
        metadata: { namespace: "default", name: "backup" },
      });
    });

    it("sets error responses when the slow dashboard query fails", async () => {
      vi.mocked(getClusterSlowDashboardEntities).mockRejectedValueOnce(new Error("kubectl failed"));
      vi.mocked(getClusterEntityInfo).mockResolvedValueOnce(successResponse("nodes", mockNodeData));

      const result = await loadClusterEntities(cluster, {
        entities: ["daemonsets", "statefulsets"],
        lightweight: true,
      });

      expect(getClusterSlowDashboardEntities).toHaveBeenCalledTimes(1);
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith(
        "daemonsets",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(result.daemonsets).toBe("kubectl failed");
      expect(result.statefulsets).toBe("kubectl failed");
    });

    it("reuses successful test entity data instead of refetching it", async () => {
      vi.mocked(getClusterEntityInfo)
        .mockResolvedValueOnce(successResponse("nodes", mockNodeData))
        .mockResolvedValueOnce(successResponse("pods", mockPodData));

      const result = await loadClusterEntities(cluster, { entities: ["nodes", "pods"] });

      expect(getClusterEntityInfo).toHaveBeenCalledTimes(2);
      expect(result.nodes).toBe(mockNodeData);
      expect(result.pods).toBe(mockPodData);
    });

    it("loadClusterEntities caches repeated unreachable entity probes", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValue(
        errorResponse(
          "nodes",
          "Unable to connect to the server: dial tcp 1.2.3.4:443: connect: no route to host",
        ),
      );

      const first = await loadClusterEntities(cluster, ["pods", "deployments"]);
      const second = await loadClusterEntities(cluster, ["pods", "deployments"]);

      expect(first.status).toBe("error");
      expect(second.status).toBe("error");
      expect(getClusterEntityInfo).toHaveBeenCalledTimes(1);
      expect(getFeatureCapability(cluster.uuid, "entity-probe:deployments,pods")).toEqual(
        expect.objectContaining({ status: "unreachable" }),
      );
    });

    it("loadClusterDataExcept - excludes specific entities", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValue(successResponse("pods", mockPodData));

      await loadClusterDataExcept(cluster, ["namespaces", "deployments"]);

      expectEntityProbe("nodes", cluster.uuid);
      expectEntityProbe("pods", cluster.uuid);
      expect(getClusterEntityInfo).not.toHaveBeenCalledWith("namespaces", expect.anything());
    });

    it("loadClusterMinimal - only testing request to cluster", async () => {
      vi.mocked(getClusterEntityInfo).mockResolvedValue(successResponse("nodes", mockNodeData));

      const result = await loadClusterMinimal(cluster);

      expect(getClusterEntityInfo).toHaveBeenCalledTimes(1); // тільки тест
      expectEntityProbe("nodes", cluster.uuid);
      expect(result.nodes).toBe(mockNodeData);
      expect(result.pods).toEqual({ items: [] });
      expect(result.status).toBe("ok");
    });

    // it("loadClusterDataResilient - doesn't stop on error", async () => {
    //   vi.mocked(getClusterEntityInfo)
    //     .mockResolvedValueOnce(errorResponse("nodes", "Access denied"))
    //     .mockResolvedValueOnce(successResponse("pods", mockPodData));

    //   const result = await loadClusterDataResilient(cluster);

    //   expect(result.offline).toBe(false);
    //   expect(result.status).toBe("error");
    //   expect(result.errors).toContain("Access denied");
    //   expect(result.pods).toBe(mockPodData);
    // });
  });
});
