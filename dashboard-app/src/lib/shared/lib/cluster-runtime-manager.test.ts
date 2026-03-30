import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  activeCapabilityDiscoveryClusterIds,
  activeDiagnosticsClusterIds,
  activeMetricsClusterIds,
  activeResourceSyncClusterIds,
  clearClusterRuntimeOverride,
  clusterRuntimeBudget,
  clusterRuntimeOverrides,
  hydrateClusterRuntimeOverrides,
  isClusterRuntimeHeavyDiagnosticsActive,
  isClusterRuntimePlaneActive,
  listClusterRuntimeOverrides,
  resetClusterRuntimeContext,
  resolveClusterRuntimeBudgetForCluster,
  resolveClusterRuntimeState,
  setClusterRuntimeDegraded,
  setClusterRuntimeBudget,
  setClusterRuntimeContext,
  setClusterRuntimeOverride,
} from "./cluster-runtime-manager";

describe("cluster-runtime-manager", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetClusterRuntimeContext();
  });

  it("activates all dashboard planes for the active cluster by default", () => {
    setClusterRuntimeContext({ activeClusterId: "cluster-a" });

    expect(get(activeResourceSyncClusterIds)).toEqual(["cluster-a"]);
    expect(get(activeDiagnosticsClusterIds)).toEqual(["cluster-a"]);
    expect(get(activeMetricsClusterIds)).toEqual(["cluster-a"]);
    expect(get(activeCapabilityDiscoveryClusterIds)).toEqual(["cluster-a"]);
    expect(isClusterRuntimePlaneActive("cluster-a", "capability_discovery")).toBe(true);
    expect(resolveClusterRuntimeState("cluster-a")).toBe("active");
  });

  it("treats warm clusters as capability-discovery only", () => {
    setClusterRuntimeContext({
      activeClusterId: "cluster-a",
      warmClusterIds: ["cluster-b", "cluster-a", "cluster-b"],
    });

    expect(resolveClusterRuntimeState("cluster-b")).toBe("warm");
    expect(get(activeCapabilityDiscoveryClusterIds)).toEqual(["cluster-a", "cluster-b"]);
    expect(isClusterRuntimePlaneActive("cluster-b", "capability_discovery")).toBe(true);
    expect(isClusterRuntimePlaneActive("cluster-b", "resource_sync")).toBe(false);
    expect(isClusterRuntimePlaneActive("cluster-b", "diagnostics")).toBe(false);
  });

  it("caps warm cluster activation by runtime budget for fleet-scale workspaces", () => {
    setClusterRuntimeBudget({
      maxWarmClusters: 2,
      maxConcurrentConnections: 4,
      maxConcurrentClusterRefreshes: 2,
      maxConcurrentDiagnostics: 1,
      maxConcurrentHeavyChecks: 1,
    });
    setClusterRuntimeContext({
      activeClusterId: "cluster-a",
      warmClusterIds: ["cluster-b", "cluster-c", "cluster-d", "cluster-e"],
    });

    expect(get(activeCapabilityDiscoveryClusterIds)).toEqual([
      "cluster-a",
      "cluster-b",
      "cluster-c",
    ]);
    expect(get(activeResourceSyncClusterIds)).toEqual(["cluster-a"]);
    expect(get(activeDiagnosticsClusterIds)).toEqual(["cluster-a"]);
    expect(get(activeMetricsClusterIds)).toEqual(["cluster-a"]);
  });

  it("stores normalized runtime budgets for fleet-style throttling", () => {
    setClusterRuntimeBudget({
      maxActiveClusters: 0,
      maxWarmClusters: -3,
      maxConcurrentConnections: 4,
      maxConcurrentClusterRefreshes: -2,
      maxConcurrentDiagnostics: -1,
      maxConcurrentHeavyChecks: -1,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "unstable",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    });

    expect(get(clusterRuntimeBudget)).toEqual({
      maxActiveClusters: 1,
      maxWarmClusters: 0,
      maxConcurrentConnections: 4,
      maxConcurrentClusterRefreshes: 1,
      maxConcurrentDiagnostics: 0,
      maxConcurrentHeavyChecks: 0,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "unstable",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    });
    expect(isClusterRuntimeHeavyDiagnosticsActive("cluster-a")).toBe(false);
  });

  it("suppresses metrics for degraded clusters while keeping core planes alive", () => {
    setClusterRuntimeContext({
      activeClusterId: "cluster-a",
      degradedClusterIds: ["cluster-a"],
      diagnosticsEnabled: true,
      metricsEnabled: true,
    });
    setClusterRuntimeBudget({ maxConcurrentHeavyChecks: 2 });

    expect(resolveClusterRuntimeState("cluster-a")).toBe("degraded");
    expect(isClusterRuntimePlaneActive("cluster-a", "resource_sync")).toBe(true);
    expect(isClusterRuntimePlaneActive("cluster-a", "metrics")).toBe(false);
    expect(isClusterRuntimeHeavyDiagnosticsActive("cluster-a")).toBe(true);
  });

  it("can toggle adaptive degraded state for a cluster without overwriting other context", () => {
    setClusterRuntimeContext({
      activeClusterId: "cluster-a",
      warmClusterIds: ["cluster-b"],
    });

    setClusterRuntimeDegraded("cluster-a", true);
    expect(resolveClusterRuntimeState("cluster-a")).toBe("degraded");

    setClusterRuntimeDegraded("cluster-a", false);
    expect(resolveClusterRuntimeState("cluster-a")).toBe("active");
    expect(resolveClusterRuntimeState("cluster-b")).toBe("warm");
  });

  it("persists per-cluster overrides and merges them with shared budgets", () => {
    hydrateClusterRuntimeOverrides();
    setClusterRuntimeBudget({
      maxConcurrentConnections: 12,
      maxConcurrentClusterRefreshes: 3,
      maxConcurrentDiagnostics: 3,
      maxConcurrentHeavyChecks: 4,
    });
    setClusterRuntimeOverride("cluster-a", {
      state: "offline",
      metricsEnabled: true,
      maxConcurrentConnections: 3,
      maxConcurrentDiagnostics: 1,
      networkSensitivity: "slow",
      metricsReadPolicy: "reuse_only",
    });

    expect(resolveClusterRuntimeState("cluster-a")).toBe("offline");
    expect(resolveClusterRuntimeBudgetForCluster("cluster-a")).toEqual({
      maxActiveClusters: 1,
      maxWarmClusters: 2,
      maxConcurrentConnections: 3,
      maxConcurrentClusterRefreshes: 3,
      maxConcurrentDiagnostics: 1,
      maxConcurrentHeavyChecks: 4,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "slow",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "background",
    });
    expect(get(clusterRuntimeOverrides)).toEqual({
      "cluster-a": {
        state: "offline",
        metricsEnabled: true,
        maxConcurrentConnections: 3,
        maxConcurrentDiagnostics: 1,
        networkSensitivity: "slow",
        metricsReadPolicy: "reuse_only",
      },
    });
    expect(listClusterRuntimeOverrides()).toEqual({
      "cluster-a": {
        state: "offline",
        metricsEnabled: true,
        maxConcurrentConnections: 3,
        maxConcurrentDiagnostics: 1,
        networkSensitivity: "slow",
        metricsReadPolicy: "reuse_only",
      },
    });

    resetClusterRuntimeContext();
    hydrateClusterRuntimeOverrides();
    expect(get(clusterRuntimeOverrides)).toEqual({});
  });

  it("can clear persisted per-cluster overrides", () => {
    setClusterRuntimeOverride("cluster-a", { state: "offline", diagnosticsEnabled: false });
    expect(resolveClusterRuntimeState("cluster-a")).toBe("offline");

    clearClusterRuntimeOverride("cluster-a");

    expect(resolveClusterRuntimeState("cluster-a")).toBe("background");
    expect(get(clusterRuntimeOverrides)).toEqual({});
  });

  it("reads persisted overrides on resolve without mutating store state inside derived callers", () => {
    window.localStorage.setItem(
      "dashboard.cluster-runtime-overrides.v1",
      JSON.stringify({
        overrides: {
          "cluster-a": {
            state: "offline",
          },
        },
      }),
    );

    expect(get(clusterRuntimeOverrides)).toEqual({});
    expect(resolveClusterRuntimeState("cluster-a")).toBe("offline");
    expect(get(clusterRuntimeOverrides)).toEqual({});

    hydrateClusterRuntimeOverrides();
    expect(get(clusterRuntimeOverrides)).toEqual({
      "cluster-a": {
        state: "offline",
      },
    });
  });

  it("keeps capability discovery off for warm clusters when mode is lazy", () => {
    setClusterRuntimeBudget({ capabilityDiscoveryMode: "lazy" });
    setClusterRuntimeContext({
      activeClusterId: "cluster-a",
      warmClusterIds: ["cluster-b"],
    });

    expect(isClusterRuntimePlaneActive("cluster-a", "capability_discovery")).toBe(true);
    expect(isClusterRuntimePlaneActive("cluster-b", "capability_discovery")).toBe(false);
    expect(get(activeCapabilityDiscoveryClusterIds)).toEqual(["cluster-a"]);
  });
});
