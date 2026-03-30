import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workloadDisplaySource = readFileSync(
  resolve("src/lib/widgets/workload/model/workload-route-registry.ts"),
  "utf8",
);
const customResourcesListSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/custom-resources/custom-resources-list.svelte"),
  "utf8",
);

describe("custom resources list routing contract", () => {
  it("routes CRDs through the dedicated custom resources surface", () => {
    expect(workloadDisplaySource).toContain("customresourcedefinitions:");
    expect(workloadDisplaySource).toContain(
      'import("$widgets/datalists/ui/custom-resources/custom-resources-list.svelte")',
    );
  });

  it("keeps CRDs inside the richer custom resources shell with instance browsing", () => {
    expect(customResourcesListSource).toContain("CustomResourcesBulkActions");
    expect(customResourcesListSource).toContain("loadInstances");
    expect(customResourcesListSource).toContain("Instances for");
    expect(customResourcesListSource).toContain("ResourceSummaryStrip");
    expect(customResourcesListSource).toContain("SectionRuntimeStatus");
    expect(customResourcesListSource).toContain("TableToolbarShell");
    expect(customResourcesListSource).toContain('label="Columns"');
  });
});
