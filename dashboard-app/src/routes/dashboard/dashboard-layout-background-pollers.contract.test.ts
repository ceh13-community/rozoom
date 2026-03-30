import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/routes/dashboard/+layout.svelte"), "utf8");

describe("dashboard layout background pollers contract", () => {
  it("clears leaked background pollers on layout init and before route navigation", () => {
    expect(source).toContain(
      'import { stopAllBackgroundPollers } from "$shared/lib/background-pollers";',
    );
    expect(source).toContain("stopAllBackgroundPollers();");
    expect(source).toContain("beforeNavigate(() => {");
    expect(source).toContain("stopAllBackgroundPollers();");
  });

  it("tracks the active dashboard cluster for runtime plane gating", () => {
    expect(source).toContain('from "$shared/lib/cluster-runtime-manager"');
    expect(source).toContain('from "$shared/lib/cluster-runtime-recency"');
    expect(source).toContain('from "$features/cluster-manager"');
    expect(source).toContain("hydrateClusterRuntimeOverrides");
    expect(source).toContain("hydrateDashboardRuntimeControlPlane");
    expect(source).toContain("setClusterRuntimeBudget");
    expect(source).toContain("resolveClusterRuntimeBudget");
    expect(source).toContain("resolveDashboardRuntimePlaneSettings");
    expect(source).toContain("function resolveActiveClusterId(pathname: string)");
    expect(source).toContain("pathname.match(/^\\/dashboard\\/clusters\\/([^/]+)/);");
    expect(source).toContain("hydrateClusterRuntimeOverrides();");
    expect(source).toContain("hydrateDashboardRuntimeControlPlane();");
    expect(source).toContain(
      "const runtimeBudget = resolveClusterRuntimeBudget($dashboardDataProfile);",
    );
    expect(source).toContain(
      "const runtimePlanes = resolveDashboardRuntimePlaneSettings($dashboardDataProfile);",
    );
    expect(source).toContain("markRecentCluster(activeClusterId);");
    expect(source).toContain("const warmClusterIds = resolveWarmClusterCandidates({");
    expect(source).toContain("pinnedClusterIds,");
    expect(source).toContain("maxWarmClusters: runtimeBudget.maxWarmClusters,");
    expect(source).toContain("setClusterRuntimeBudget(runtimeBudget);");
    expect(source).toContain("setClusterRuntimeContext({");
    expect(source).toContain("activeClusterId,");
    expect(source).toContain("warmClusterIds,");
    expect(source).toContain("diagnosticsEnabled: runtimePlanes.diagnosticsEnabled,");
    expect(source).toContain("metricsEnabled: runtimePlanes.metricsEnabled,");
  });
});
