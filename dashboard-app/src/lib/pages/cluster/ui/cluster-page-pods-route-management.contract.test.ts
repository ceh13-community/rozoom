import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const workloadConfigSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-workload-config.ts"),
  "utf8",
);
const panesSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-panes.ts"),
  "utf8",
);

describe("cluster page pods route management contract", () => {
  it("bypasses generic workloads fetcher for pods views", () => {
    expect(source).toContain('if (routeWorkloadType === "pods") {');
    expect(source).toContain("workloads.reset();");
    expect(source).toContain(
      'const isRouteManagedPodsView = $derived(routeWorkloadType === "pods");',
    );
  });

  it("treats pods panes as renderable without workload snapshot data", () => {
    expect(source).toContain("return derivePaneHasEffectiveData(");
    expect(panesSource).toContain(
      "return hasRenderableWorkloadData(params.pane.workload, params.workloadData);",
    );
    expect(workloadConfigSource).toContain(
      'if (CLUSTER_HEALTH_WORKLOADS.includes(workload) || workload === "pods") return true;',
    );
  });
});
