import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/pages/cluster-manager/ui/cluster-manager.svelte"),
  "utf8",
);

describe("manage page live status", () => {
  it("filters Online only / Offline only by the same live verdict as the row pill", () => {
    expect(source).toContain("matchesManagedStatusFilter(managedStatusFilter, {");
    expect(source).toContain("liveProblem: rowLiveProblem(cluster),");
    expect(source).not.toContain('managedStatusFilter === "online" && cluster.offline');
  });

  it("re-checks known clusters while the page is open and stops when it closes", () => {
    expect(source).toContain(
      "pickClusterIds: () => clustersToRecheck(get(clustersList), get(clusterConnectivity)),",
    );
    expect(source).toContain("check: checkClusterConnectivity,");
    expect(source).toContain('isPageVisible: () => document.visibilityState !== "hidden",');
    expect(source).toContain("connectivityRefresh?.stop();");
    // The first round runs once the list is loaded, and again on return to the window.
    expect(source.indexOf("await loadData();")).toBeLessThan(
      source.indexOf("connectivityRefresh = startConnectivityRefresh({"),
    );
    expect(source).toContain(
      'document.addEventListener("visibilitychange", handleVisibilityChange);',
    );
    expect(source).toContain(
      'document.removeEventListener("visibilitychange", handleVisibilityChange);',
    );
  });
});
