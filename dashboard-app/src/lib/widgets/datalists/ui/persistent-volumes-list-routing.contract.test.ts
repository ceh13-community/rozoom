import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workloadDisplaySource = readFileSync(
  resolve("src/lib/widgets/workload/model/workload-route-registry.ts"),
  "utf8",
);
const configurationListSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);

describe("persistent volumes list routing contract", () => {
  it("routes persistent volumes through the shared workload-reference boundary", () => {
    expect(workloadDisplaySource).toContain(
      'persistentvolumes: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps persistent volumes inside the shared workload shell", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain("persistentvolumes");
  });
});
