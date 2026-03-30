import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const workspaceSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-workspace.ts"),
  "utf8",
);

describe("cluster page cluster selector contract", () => {
  it("renders cluster selector in pane meta and routes cluster switch", () => {
    expect(source).toContain("const clusterSelectOptions = $derived.by(() => {");
    expect(source).toContain('aria-label="Select cluster"');
    expect(workspaceSource).toContain("export function toClusterWorkloadHref(");
    expect(workspaceSource).toContain("workload: WorkloadType,");
    expect(workspaceSource).toContain("clusterId: string,");
    expect(source).toContain("async function handleClusterSelectionChange(nextClusterId: string)");
    expect(source).toContain("let clusterSwitchInFlight = $state(false);");
    expect(source).toContain('const nextWorkload = routeWorkloadType || "overview";');
    expect(source).toContain('if (nextWorkload !== "overview") {');
    expect(source).toContain("void prefetchWorkloadSnapshots({");
    expect(source).toContain(
      'await gotoFromWorkspace(\n        toClusterWorkloadHref(nextWorkload, sortField || "name", nextClusterId),',
    );
    expect(source).toContain("disabled={$isClustersConfigLoading || clusterSwitchInFlight}");
    const selectorOccurrences = source.match(/aria-label="Select cluster"/g)?.length ?? 0;
    expect(selectorOccurrences).toBe(3);
  });
});
