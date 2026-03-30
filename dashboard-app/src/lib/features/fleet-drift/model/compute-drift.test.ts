import { describe, it, expect } from "vitest";
import { computeFleetDrift } from "./compute-drift";
import type { ClusterHealthChecks } from "$features/check-health/model/types";

function makeChecks(overrides: Partial<ClusterHealthChecks> = {}): ClusterHealthChecks {
  return {
    daemonSets: 0,
    deployments: 0,
    jobs: 0,
    replicaSets: 0,
    pods: 0,
    statefulSets: 0,
    namespaces: [],
    podRestarts: [],
    cronJobs: 0,
    cronJobsHealth: {
      items: [],
      summary: { total: 0, ok: 0, warning: 0, critical: 0, unknown: 0 },
      updatedAt: Date.now(),
    },
    nodes: null,
    metricsChecks: { endpoints: {} },
    timestamp: Date.now(),
    ...overrides,
  } as ClusterHealthChecks;
}

describe("computeFleetDrift", () => {
  it("returns empty state for no clusters", () => {
    const result = computeFleetDrift([]);
    expect(result.snapshots).toEqual({});
    expect(result.fleetBaseline.k8sVersion).toBe("unknown");
    expect(result.alignmentPercent).toBe(100);
    expect(result.totalClusters).toBe(0);
  });

  it("detects no drift when all clusters are identical", () => {
    const checks = makeChecks({
      podSecurity: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        namespaces: [],
        items: [],
        updatedAt: Date.now(),
      },
      networkIsolation: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
      pdbStatus: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
    });

    const result = computeFleetDrift([
      { clusterId: "a", clusterName: "cluster-a", checks },
      { clusterId: "b", clusterName: "cluster-b", checks },
      { clusterId: "c", clusterName: "cluster-c", checks },
    ]);

    expect(result.snapshots["a"].driftCount).toBe(0);
    expect(result.snapshots["a"].severity).toBe("ok");
    expect(result.snapshots["b"].driftCount).toBe(0);
  });

  it("detects drift when one cluster differs from majority", () => {
    const majorityChecks = makeChecks({
      podSecurity: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        namespaces: [],
        items: [],
        updatedAt: Date.now(),
      },
      networkIsolation: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
    });

    const driftedChecks = makeChecks({
      podSecurity: {
        status: "warning",
        summary: {
          status: "warning",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        namespaces: [],
        items: [],
        updatedAt: Date.now(),
      },
      networkIsolation: {
        status: "critical",
        summary: {
          status: "critical",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
    });

    const result = computeFleetDrift([
      { clusterId: "a", clusterName: "cluster-a", checks: majorityChecks },
      { clusterId: "b", clusterName: "cluster-b", checks: majorityChecks },
      { clusterId: "c", clusterName: "drifted", checks: driftedChecks },
    ]);

    expect(result.snapshots["a"].driftCount).toBe(0);
    expect(result.snapshots["b"].driftCount).toBe(0);
    expect(result.snapshots["c"].driftCount).toBe(2);
    expect(result.snapshots["c"].severity).toBe("critical"); // PSA is critical-severity dimension

    const psaDrift = result.snapshots["c"].drifts.find((d) => d.dimension === "psaEnforcement");
    expect(psaDrift?.isDrifted).toBe(true);
    expect(psaDrift?.clusterValue).toBe("warning");
    expect(psaDrift?.fleetMajority).toBe("ok");
  });

  it("marks severity critical when 3+ dimensions drift", () => {
    const majorityChecks = makeChecks({
      podSecurity: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        namespaces: [],
        items: [],
        updatedAt: Date.now(),
      },
      networkIsolation: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
      pdbStatus: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
    });

    const heavilyDrifted = makeChecks({
      podSecurity: {
        status: "critical",
        summary: {
          status: "critical",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        namespaces: [],
        items: [],
        updatedAt: Date.now(),
      },
      networkIsolation: {
        status: "critical",
        summary: {
          status: "critical",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
      pdbStatus: {
        status: "critical",
        summary: {
          status: "critical",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
    });

    const result = computeFleetDrift([
      { clusterId: "a", clusterName: "ok-1", checks: majorityChecks },
      { clusterId: "b", clusterName: "ok-2", checks: majorityChecks },
      { clusterId: "c", clusterName: "drifted", checks: heavilyDrifted },
    ]);

    expect(result.snapshots["c"].driftCount).toBe(3);
    expect(result.snapshots["c"].severity).toBe("critical");
  });

  it("ignores unknown values in baseline computation", () => {
    const withData = makeChecks({
      podSecurity: {
        status: "ok",
        summary: {
          status: "ok",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        namespaces: [],
        items: [],
        updatedAt: Date.now(),
      },
    });
    const withoutData = makeChecks();

    const result = computeFleetDrift([
      { clusterId: "a", clusterName: "has-data", checks: withData },
      { clusterId: "b", clusterName: "no-data", checks: withoutData },
    ]);

    expect(result.fleetBaseline.psaEnforcement).toBe("ok");
    // Cluster without data should not be counted as drifted
    const bSnapshot = result.snapshots["b"];
    const psaDrift = bSnapshot.drifts.find((d) => d.dimension === "psaEnforcement");
    expect(psaDrift?.isDrifted).toBe(false); // unknown != ok but unknown is excluded
  });

  it("computes baseline from single cluster", () => {
    const checks = makeChecks({
      networkIsolation: {
        status: "warning",
        summary: {
          status: "warning",
          message: "",
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          updatedAt: Date.now(),
        },
        items: [],
        updatedAt: Date.now(),
      },
    });

    const result = computeFleetDrift([{ clusterId: "solo", clusterName: "solo-cluster", checks }]);

    expect(result.snapshots["solo"].driftCount).toBe(0);
    expect(result.fleetBaseline.networkPolicyCoverage).toBe("warning");
  });
});
