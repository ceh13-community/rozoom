import { beforeEach, describe, expect, it } from "vitest";
import {
  getDashboardDataProfile,
  getDashboardDataProfileDisplayName,
  getDashboardDataProfileModeHint,
  hydrateDashboardDataProfile,
  clearDashboardRuntimeControlPlane,
  listDashboardDataProfiles,
  resolveClusterRuntimeBudget,
  resolveDashboardRuntimePlaneSettings,
  resolveCoreResourceSyncPolicy,
  resolveDerivedRefreshPolicy,
  resolveDashboardCardAutoRefreshLimit,
  resolvePrefetchConcurrency,
  setDashboardDataProfile,
  setDashboardRuntimeControlPlane,
  shouldAutoRunDiagnostics,
} from "./dashboard-data-profile.svelte";

describe("dashboard data profile", () => {
  beforeEach(() => {
    window.localStorage.clear();
    clearDashboardRuntimeControlPlane();
    setDashboardDataProfile("balanced");
  });

  it("hydrates balanced profile by default", () => {
    hydrateDashboardDataProfile();
    expect(getDashboardDataProfile().id).toBe("balanced");
  });

  it("persists selected profile", () => {
    setDashboardDataProfile("low_load");
    expect(getDashboardDataProfile().id).toBe("low_load");
    expect(window.localStorage.getItem("dashboard.data-profile.v1")).toContain("low_load");
  });

  it("exposes user-facing runtime profile labels and hints", () => {
    expect(getDashboardDataProfileDisplayName("realtime")).toBe("Fast LAN");
    expect(getDashboardDataProfileDisplayName("low_load")).toBe("Slow Internet / Limited API");
    expect(getDashboardDataProfileDisplayName("manual")).toBe("Manual / Custom");
    expect(getDashboardDataProfileModeHint("fleet")).toContain("background summary");
  });

  it("exposes fleet mode for large cluster sets", () => {
    setDashboardDataProfile("fleet");
    expect(getDashboardDataProfile().id).toBe("fleet");
    expect(window.localStorage.getItem("dashboard.data-profile.v1")).toContain("fleet");
  });

  it("resolves stream-first policy for balanced core resources", () => {
    const profile = listDashboardDataProfiles().find((entry) => entry.id === "balanced")!;
    expect(
      resolveCoreResourceSyncPolicy(profile, {
        userEnabled: true,
        requestedRefreshSeconds: 15,
        supportsStream: true,
      }),
    ).toEqual({
      enabled: true,
      mode: "stream",
      refreshSeconds: 30,
    });
  });

  it("falls back to polling in low-load mode when polling fallback exists", () => {
    const profile = listDashboardDataProfiles().find((entry) => entry.id === "low_load")!;
    expect(
      resolveCoreResourceSyncPolicy(profile, {
        userEnabled: true,
        requestedRefreshSeconds: 20,
        supportsStream: true,
      }),
    ).toEqual({
      enabled: true,
      mode: "poll",
      refreshSeconds: 60,
    });
  });

  it("keeps stream mode when no polling fallback exists", () => {
    const profile = listDashboardDataProfiles().find((entry) => entry.id === "low_load")!;
    expect(
      resolveCoreResourceSyncPolicy(profile, {
        userEnabled: true,
        requestedRefreshSeconds: 20,
        supportsStream: true,
        supportsPollingFallback: false,
      }),
    ).toEqual({
      enabled: true,
      mode: "stream",
      refreshSeconds: 60,
    });
  });

  it("disables automatic derived refresh and diagnostics in manual mode", () => {
    const profile = listDashboardDataProfiles().find((entry) => entry.id === "manual")!;
    expect(
      resolveDerivedRefreshPolicy(profile, {
        userEnabled: true,
        requestedRefreshSeconds: 15,
      }),
    ).toEqual({
      enabled: false,
      refreshSeconds: 300,
    });
    expect(shouldAutoRunDiagnostics(profile)).toBe(false);
  });

  it("caps prefetch concurrency by profile", () => {
    const profile = listDashboardDataProfiles().find((entry) => entry.id === "balanced")!;
    expect(resolvePrefetchConcurrency(profile, 6)).toBe(4);
  });

  it("keeps fleet prefetch concurrency pinned to one even under high requested load", () => {
    const fleet = listDashboardDataProfiles().find((entry) => entry.id === "fleet")!;
    expect(resolvePrefetchConcurrency(fleet, 100)).toBe(2);
  });

  it("limits dashboard card auto refresh by profile", () => {
    const manual = listDashboardDataProfiles().find((entry) => entry.id === "manual")!;
    const realtime = listDashboardDataProfiles().find((entry) => entry.id === "realtime")!;
    const fleet = listDashboardDataProfiles().find((entry) => entry.id === "fleet")!;
    expect(resolveDashboardCardAutoRefreshLimit(manual)).toBe(0);
    expect(resolveDashboardCardAutoRefreshLimit(realtime)).toBe(8);
    expect(resolveDashboardCardAutoRefreshLimit(fleet)).toBe(12);
  });

  it("returns runtime budgets tuned for fleet mode", () => {
    const fleet = listDashboardDataProfiles().find((entry) => entry.id === "fleet")!;
    expect(resolveClusterRuntimeBudget(fleet)).toEqual({
      maxActiveClusters: 1,
      maxWarmClusters: 4,
      maxConcurrentConnections: 20,
      maxConcurrentClusterRefreshes: 6,
      maxConcurrentDiagnostics: 2,
      maxConcurrentHeavyChecks: 2,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "slow",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    });
  });

  it("merges control-plane budget overrides into the active profile", () => {
    const balanced = listDashboardDataProfiles().find((entry) => entry.id === "balanced")!;
    setDashboardRuntimeControlPlane({
      maxWarmClusters: 5,
      maxConcurrentConnections: 7,
      networkSensitivity: "slow",
    });

    expect(resolveClusterRuntimeBudget(balanced)).toEqual({
      maxActiveClusters: 2,
      maxWarmClusters: 5,
      maxConcurrentConnections: 7,
      maxConcurrentClusterRefreshes: 5,
      maxConcurrentDiagnostics: 3,
      maxConcurrentHeavyChecks: 4,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "slow",
      metricsReadPolicy: "cached",
      capabilityDiscoveryMode: "background",
    });
  });

  it("merges fetch and diagnostics policy overrides into the active profile", () => {
    const balanced = listDashboardDataProfiles().find((entry) => entry.id === "balanced")!;
    setDashboardRuntimeControlPlane({
      maxConcurrentClusterRefreshes: 2,
      maxConcurrentDiagnostics: 1,
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    });

    expect(resolveClusterRuntimeBudget(balanced)).toEqual({
      maxActiveClusters: 2,
      maxWarmClusters: 4,
      maxConcurrentConnections: 16,
      maxConcurrentClusterRefreshes: 2,
      maxConcurrentDiagnostics: 1,
      maxConcurrentHeavyChecks: 4,
      autoSuspendInactiveClusters: true,
      networkSensitivity: "normal",
      metricsReadPolicy: "reuse_only",
      capabilityDiscoveryMode: "lazy",
    });
  });

  it("merges control-plane plane toggles into the active profile defaults", () => {
    const manual = listDashboardDataProfiles().find((entry) => entry.id === "manual")!;
    setDashboardRuntimeControlPlane({
      diagnosticsEnabled: true,
      metricsEnabled: true,
      capabilityDiscoveryEnabled: false,
    });

    expect(resolveDashboardRuntimePlaneSettings(manual)).toEqual({
      resourceSyncEnabled: true,
      diagnosticsEnabled: true,
      metricsEnabled: true,
      capabilityDiscoveryEnabled: false,
    });
  });
});
