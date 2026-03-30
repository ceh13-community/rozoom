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

describe("network policies list routing contract", () => {
  it("routes network policies through the shared workload-reference boundary", () => {
    expect(workloadDisplaySource).toContain(
      'networkpolicies: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps network policies on the shared workload shell", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
  });
});
