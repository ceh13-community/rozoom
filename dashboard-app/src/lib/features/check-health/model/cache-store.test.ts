import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLastHealthCheck,
  hydrateLatestHealthChecks,
  clusterHealthChecks,
  setClusterCheck,
  isHealthCheckLoading,
  errors,
  updateClusterCheckPartially,
} from "./cache-store";
import { get } from "svelte/store";
import { getCache, removeCache, setCache } from "$shared/cache";
import type { ClusterCheckError, ClusterHealthChecks, HealthChecks } from "./types";

vi.mock("@/lib/shared/cache", () => ({
  getCache: vi.fn(),
  removeCache: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock("$shared/lib/cache-worker-proxy", () => ({
  sanitizeInWorker: vi.fn(<T>(data: T) => Promise.resolve(data)),
}));

const mockTimestamp = 1704067200000;

const emptyCronJobsHealth = {
  items: [],
  summary: {
    total: 0,
    ok: 0,
    warning: 0,
    critical: 0,
    unknown: 0,
  },
  updatedAt: mockTimestamp,
};

/**
 * Helper: configure getCache mock to return per-cluster data for sharded keys
 * and optionally a legacy monolithic object for `health_checks`.
 *
 * `clusterData` maps clusterId -> array of checks.
 * When getCache is called with `health_checks:{clusterId}`, it returns that array.
 * When called with `health_checks`, it returns `legacyData` (default null).
 */
function mockPerClusterCache(
  clusterData: Record<string, Array<ClusterHealthChecks | ClusterCheckError>>,
  legacyData: HealthChecks | null = null,
) {
  vi.mocked(getCache).mockImplementation(async (key: string) => {
    for (const [clusterId, checks] of Object.entries(clusterData)) {
      if (key === `health_checks:${clusterId}`) {
        return checks;
      }
    }
    if (key === "health_checks") {
      return legacyData;
    }
    return null;
  });
}

describe("getLastHealthCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not crash if data[clusterId] is undefined", async () => {
    // Sharded key returns null, legacy returns empty object -> no checks for "abc"
    mockPerClusterCache({});

    const result = await getLastHealthCheck("abc");

    expect(result).toBeNull();
    expect(get(clusterHealthChecks)["abc"]).toBeNull();
  });

  it("should return null when cache returns null", async () => {
    // Both sharded and legacy return null
    vi.mocked(getCache).mockResolvedValue(null);

    const result = await getLastHealthCheck("abc");

    expect(result).toBeNull();
    expect(get(clusterHealthChecks)["abc"]).toBeNull();
  });

  it("should return the most recent check without mutating original array", async () => {
    const checks = [
      { timestamp: 10, deployments: 1 },
      { timestamp: 20, deployments: 2 },
    ] as unknown as Array<ClusterHealthChecks>;

    mockPerClusterCache({ abc: checks });

    const result = await getLastHealthCheck("abc");

    expect(result?.timestamp).toBe(20);
    expect(checks[0].timestamp).toBe(10);
  });

  it("hydrates the latest checks for multiple clusters in a single cache read", async () => {
    mockPerClusterCache({
      abc: [
        { timestamp: 10, deployments: 1 },
        { timestamp: 20, deployments: 2 },
      ] as unknown as Array<ClusterHealthChecks>,
      def: [{ timestamp: 5, deployments: 3 }] as unknown as Array<ClusterHealthChecks>,
    });

    const result = await hydrateLatestHealthChecks(["abc", "def"]);

    expect(result).toEqual({
      abc: { timestamp: 20, deployments: 2 },
      def: { timestamp: 5, deployments: 3 },
    });
    expect(get(clusterHealthChecks)).toMatchObject({
      abc: { timestamp: 20, deployments: 2 },
      def: { timestamp: 5, deployments: 3 },
    });
    // Now reads per-cluster: 2 calls for sharded keys (abc, def)
    // Each getClusterCacheChecks calls getCache once for the sharded key (which succeeds)
    expect(getCache).toHaveBeenCalledWith("health_checks:abc");
    expect(getCache).toHaveBeenCalledWith("health_checks:def");
  });

  it("hydrates the latest lightweight snapshot with persisted diagnostics state from an older richer check", async () => {
    mockPerClusterCache({
      abc: [
        {
          timestamp: 30,
          deployments: 2,
          nodes: {
            summary: {
              count: { total: 1, ready: 1, pressures: {} },
              status: "OK",
              className: "bg-emerald-600",
            },
          },
        },
        {
          timestamp: 20,
          deployments: 2,
          nodes: {
            summary: {
              count: { total: 1, ready: 1, pressures: {} },
              status: "OK",
              className: "bg-emerald-600",
            },
          },
          diagnosticsSnapshots: {
            configLoadedAt: 18,
            healthLoadedAt: 19,
          },
          apiServerLatency: { status: "warning", updatedAt: 19 },
          resourcesHygiene: {
            status: "ok",
            summary: {
              status: "ok",
              total: 0,
              ok: 0,
              warning: 0,
              critical: 0,
              bestEffort: 0,
              updatedAt: 19,
            },
            workloads: [],
            items: [],
            updatedAt: 19,
          },
        },
      ] as unknown as Array<ClusterHealthChecks>,
    });

    const result = await getLastHealthCheck("abc");

    expect(result).toMatchObject({
      timestamp: 30,
      diagnosticsSnapshots: {
        configLoadedAt: 18,
        healthLoadedAt: 19,
      },
      apiServerLatency: { status: "warning" },
      resourcesHygiene: { status: "ok" },
    });
  });

  it("hydrates fleet cards with richer diagnostics markers even when the newest cache entry is dashboard-only", async () => {
    mockPerClusterCache({
      abc: [
        {
          timestamp: 50,
          deployments: 3,
          nodes: {
            summary: {
              count: { total: 2, ready: 2, pressures: {} },
              status: "OK",
              className: "bg-emerald-600",
            },
          },
        },
        {
          timestamp: 40,
          deployments: 3,
          nodes: {
            summary: {
              count: { total: 2, ready: 2, pressures: {} },
              status: "OK",
              className: "bg-emerald-600",
            },
          },
          diagnosticsSnapshots: {
            configLoadedAt: 38,
            healthLoadedAt: 39,
          },
          podIssues: {
            status: "critical",
            summary: { status: "critical", warnings: [], updatedAt: 39 },
            items: [],
            totalPods: 0,
            crashLoopCount: 0,
            pendingCount: 0,
            updatedAt: 39,
          },
        },
      ] as unknown as Array<ClusterHealthChecks>,
    });

    const result = await hydrateLatestHealthChecks(["abc"]);

    expect(result).toMatchObject({
      abc: {
        timestamp: 50,
        diagnosticsSnapshots: {
          configLoadedAt: 38,
          healthLoadedAt: 39,
        },
        podIssues: {
          status: "critical",
        },
      },
    });
  });

  it("should limit stored checks count", async () => {
    const oldItems = Array.from({ length: 20 }, (_, i) => ({
      timestamp: i + 1,
      deployments: i,
    })) as unknown as Array<ClusterHealthChecks>;

    mockPerClusterCache({ abc: oldItems });

    const newCheck = { timestamp: 100, deployments: 999 };

    await setClusterCheck("abc", newCheck as ClusterHealthChecks);

    // setCache is now called with per-cluster key and a flat array
    const payload = vi.mocked(setCache).mock.calls[0][1] as Array<ClusterHealthChecks>;
    console.log("payload", payload.length);
    expect(payload[0]).toEqual(newCheck);
  });

  it("should populate errors store when data contains errors", async () => {
    mockPerClusterCache({ abc: [] });

    const bug = {
      timestamp: 1,
      deployments: 0,
      namespaces: [],
      replicaSets: 0,
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: {},
      errors: "Boom",
    };

    await setClusterCheck("abc", bug);

    expect(get(errors)).toBe("Boom");
  });

  it("updates the in-memory store without persisting when persistToCache=false", async () => {
    mockPerClusterCache({ abc: [] });

    const check = {
      timestamp: 2,
      deployments: 1,
      namespaces: [],
      replicaSets: 0,
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
    } as unknown as ClusterHealthChecks;

    await setClusterCheck("abc", check, { persistToCache: false });

    expect(get(clusterHealthChecks).abc).toEqual(check);
    expect(setCache).not.toHaveBeenCalled();
  });

  it("serializes Set values before writing health checks to cache", async () => {
    mockPerClusterCache({ abc: [] });

    const data = {
      timestamp: 1,
      deployments: 0,
      namespaces: [],
      replicaSets: 0,
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: {
        endpoints: {},
        pipeline: {
          fallbackOrder: ["api"],
          sources: [],
          recommendations: [],
          checkedAt: "now",
        },
      },
      resourcesHygiene: {
        status: "ok",
        summary: {
          status: "ok",
          message: "ok",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          bestEffort: 0,
          updatedAt: mockTimestamp,
        },
        workloads: [],
        items: [],
        updatedAt: mockTimestamp,
        extra: new Set(["pods", "deployments"]),
      },
    };

    await setClusterCheck("abc", data as unknown as ClusterHealthChecks);

    // setCache is now called with per-cluster key and a flat array
    const payload = vi.mocked(setCache).mock.calls[0][1] as Array<
      ClusterHealthChecks & { resourcesHygiene: { extra: string[] } }
    >;
    expect(payload[0].resourcesHygiene.extra).toEqual(["pods", "deployments"]);
  });

  it("recovers when reading existing health cache throws", async () => {
    // The sharded getCache call throws, then the legacy fallback also needs to be handled.
    // getClusterCacheChecks: sharded key throws -> falls through to legacy getCache("health_checks")
    // which also throws -> triggers recoverHealthChecksCache -> returns []
    vi.mocked(getCache).mockRejectedValue(new TypeError("Type error: Set@[native code]"));

    await setClusterCheck("abc", {
      timestamp: 1,
      deployments: 0,
      namespaces: [],
      replicaSets: 0,
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
    } as unknown as ClusterHealthChecks);

    expect(setCache).toHaveBeenCalledWith(
      "health_checks:abc",
      expect.arrayContaining([
        expect.objectContaining({
          timestamp: 1,
        }),
      ]),
    );
    expect(vi.mocked(removeCache).mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("sanitizes poisoned existing cache entries before merging next write", async () => {
    // Only the abc cluster data matters now (per-cluster sharding)
    mockPerClusterCache({ abc: [] });

    await setClusterCheck("abc", {
      timestamp: 2,
      deployments: 1,
      namespaces: [],
      replicaSets: 0,
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
    } as unknown as ClusterHealthChecks);

    // setCache is now called with per-cluster key and a flat array
    const payload = vi.mocked(setCache).mock.calls[0][1] as Array<ClusterHealthChecks>;

    expect(payload[0]).toMatchObject({ timestamp: 2, deployments: 1 });
  });
});

describe("updateClusterCheckPartially", () => {
  const clusterId = "test-cluster-1";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(mockTimestamp);
    vi.spyOn(console, "log").mockImplementation(() => {});

    isHealthCheckLoading.set(false);
    errors.set(null);

    vi.mocked(getCache).mockResolvedValue(null);
    vi.mocked(setCache).mockResolvedValue();
  });

  it("should return early if clusterId is empty", async () => {
    await updateClusterCheckPartially("", { deployments: 5 });

    expect(getCache).not.toHaveBeenCalled();
    expect(setCache).not.toHaveBeenCalled();
  });

  it("should set loading state during update", async () => {
    const promise = updateClusterCheckPartially(clusterId, { deployments: 5 });

    expect(get(isHealthCheckLoading)).toBe(true);

    await promise;

    expect(get(isHealthCheckLoading)).toBe(false);
  });

  it("should clear errors at start", async () => {
    errors.set("Previous error");

    await updateClusterCheckPartially(clusterId, { deployments: 5 });

    expect(get(errors)).toBeNull();
  });

  it("should create base check when no existing checks found", async () => {
    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, { deployments: 5 });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          daemonSets: 0,
          deployments: 5,
          jobs: 0,
          pods: 0,
          replicaSets: 0,
          statefulSets: 0,
          namespaces: [],
          podRestarts: [],
          cronJobs: 0,
          cronJobsHealth: emptyCronJobsHealth,
          nodes: null,
          metricsChecks: { endpoints: {} },
          timestamp: mockTimestamp,
        }),
      ]),
    );
  });

  it("should merge partial data with existing base check", async () => {
    const existingCheck: ClusterHealthChecks = {
      daemonSets: 0,
      deployments: 10,
      jobs: 0,
      pods: 0,
      replicaSets: 5,
      statefulSets: 0,
      namespaces: ["default", "kube-system"],
      podRestarts: [],
      cronJobs: 2,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
      timestamp: mockTimestamp - 1000,
    };

    mockPerClusterCache({ [clusterId]: [existingCheck] });

    await updateClusterCheckPartially(clusterId, { deployments: 15 });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          daemonSets: 0,
          deployments: 15,
          jobs: 0,
          pods: 0,
          replicaSets: 5,
          statefulSets: 0,
          namespaces: ["default", "kube-system"],
          podRestarts: [],
          cronJobs: 2,
          cronJobsHealth: emptyCronJobsHealth,
          nodes: null,
          metricsChecks: { endpoints: {} },
          timestamp: mockTimestamp,
        }),
      ]),
    );
  });

  it("should skip checks with errors when finding base check", async () => {
    const errorCheck: ClusterCheckError = {
      errors: "Some error",
      timestamp: mockTimestamp - 2000,
    };

    const validCheck: ClusterHealthChecks = {
      daemonSets: 0,
      deployments: 10,
      jobs: 0,
      pods: 0,
      replicaSets: 5,
      statefulSets: 0,
      namespaces: [],
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
      timestamp: mockTimestamp - 1000,
    };

    mockPerClusterCache({ [clusterId]: [errorCheck, validCheck] });

    await updateClusterCheckPartially(clusterId, { deployments: 20 });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          deployments: 20,
          replicaSets: 5,
        }),
      ]),
    );
  });

  it("should update multiple fields at once", async () => {
    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, {
      deployments: 5,
      replicaSets: 3,
      cronJobs: 2,
    });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          deployments: 5,
          replicaSets: 3,
          cronJobs: 2,
        }),
      ]),
    );
  });

  it("should handle nodes field update", async () => {
    const nodesData = {
      checks: [],
      summary: {
        className: "green",
        status: "Ok",
        count: {
          ready: 0,
          total: 0,
          pressures: {
            diskPressure: 0,
            memoryPressure: 0,
            pidPressure: 0,
            networkUnavailable: 0,
          },
        },
      },
    };

    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, { nodes: nodesData });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          nodes: nodesData,
        }),
      ]),
    );
  });

  it("should handle namespaces array update", async () => {
    const namespaces = ["default", "kube-system", "monitoring"];

    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, { namespaces });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          namespaces,
        }),
      ]),
    );
  });

  it("should handle podRestarts array update", async () => {
    const podRestarts = [
      { namespace: "default", pod: "pod-1", containers: [] },
      { namespace: "default", pod: "pod-2", containers: [] },
    ];

    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, { podRestarts });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          podRestarts,
        }),
      ]),
    );
  });

  it("should set error in partial data when provided", async () => {
    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, {
      deployments: 5,
      errors: "Partial error occurred",
    });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          deployments: 5,
          errors: "Partial error occurred",
        }),
      ]),
    );
  });

  it("should set errors to undefined when not provided in partial data", async () => {
    const existingCheck: ClusterHealthChecks & { errors?: string } = {
      daemonSets: 0,
      deployments: 10,
      jobs: 0,
      pods: 0,
      replicaSets: 5,
      statefulSets: 0,
      namespaces: [],
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
      timestamp: mockTimestamp - 1000,
      errors: "Previous error",
    };

    mockPerClusterCache({ [clusterId]: [existingCheck as ClusterHealthChecks] });

    await updateClusterCheckPartially(clusterId, { deployments: 15 });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          deployments: 15,
          errors: undefined,
        }),
      ]),
    );
  });

  // it("should handle error during update and create error check", async () => {
  //   const error = new Error("Cache update failed");
  //   vi.mocked(getCache).mockRejectedValue(error);
  //   vi.mocked(setCache).mockResolvedValue();

  //   await updateClusterCheckPartially(clusterId, { deployments: 5 });

  //   expect(get(errors)).toBe("Cache update failed");
  //   expect(setCache).toHaveBeenCalledWith(
  //     `health_checks:${clusterId}`,
  //     expect.arrayContaining([
  //       expect.objectContaining({
  //         errors: "Cache update failed",
  //         timestamp: mockTimestamp,
  //       }),
  //     ]),
  //   );
  // });

  // it("should handle non-Error exceptions", async () => {
  //   vi.mocked(getCache).mockRejectedValue("String error");
  //   vi.mocked(setCache).mockResolvedValue();

  //   await updateClusterCheckPartially(clusterId, { deployments: 5 });

  //   expect(get(errors)).toBe("Unknown error during partial update");
  //   expect(setCache).toHaveBeenCalledWith(
  //     `health_checks:${clusterId}`,
  //     expect.arrayContaining([
  //       expect.objectContaining({
  //         errors: "Unknown error during partial update",
  //         timestamp: mockTimestamp,
  //       }),
  //     ]),
  //   );
  // });

  it("should update cache without console logging large payloads", async () => {
    vi.mocked(getCache).mockResolvedValue(null);

    const partialData = { deployments: 5, replicaSets: 3 };
    await updateClusterCheckPartially(clusterId, partialData);

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          deployments: 5,
          replicaSets: 3,
          timestamp: mockTimestamp,
        }),
      ]),
    );
  });

  it("should update timestamp on every update", async () => {
    const oldTimestamp = mockTimestamp - 5000;
    const existingCheck: ClusterHealthChecks = {
      daemonSets: 0,
      deployments: 10,
      jobs: 0,
      pods: 0,
      replicaSets: 5,
      statefulSets: 0,
      namespaces: [],
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks: { endpoints: {} },
      timestamp: oldTimestamp,
    };

    mockPerClusterCache({ [clusterId]: [existingCheck] });

    await updateClusterCheckPartially(clusterId, { deployments: 15 });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          timestamp: mockTimestamp,
        }),
      ]),
    );
  });

  it("should handle empty partial data", async () => {
    vi.mocked(getCache).mockResolvedValue(null);

    await updateClusterCheckPartially(clusterId, {});

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          deployments: 0,
          replicaSets: 0,
          timestamp: mockTimestamp,
        }),
      ]),
    );
  });

  it("should preserve metricsChecks from base check", async () => {
    const metricsChecks = {
      endpoints: {
        "endpoint-1": { lastSync: "0", status: "healthy", title: "Endpoint 1" },
        "endpoint-2": { lastSync: "0", status: "unhealthy", title: "Endpoint 2" },
      },
    };

    const existingCheck: ClusterHealthChecks = {
      daemonSets: 0,
      deployments: 10,
      jobs: 0,
      pods: 0,
      replicaSets: 5,
      statefulSets: 0,
      namespaces: [],
      podRestarts: [],
      cronJobs: 0,
      cronJobsHealth: emptyCronJobsHealth,
      nodes: null,
      metricsChecks,
      timestamp: mockTimestamp - 1000,
    };

    mockPerClusterCache({ [clusterId]: [existingCheck] });

    await updateClusterCheckPartially(clusterId, { deployments: 15 });

    expect(setCache).toHaveBeenCalledWith(
      `health_checks:${clusterId}`,
      expect.arrayContaining([
        expect.objectContaining({
          metricsChecks,
        }),
      ]),
    );
  });
});
