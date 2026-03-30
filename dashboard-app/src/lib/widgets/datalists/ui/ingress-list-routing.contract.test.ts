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

describe("ingress list routing contract", () => {
  it("routes ingress workloads through the shared workload-reference boundary", () => {
    expect(workloadDisplaySource).toContain(
      'ingresses: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'ingressclasses: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps ingress pages on the shared workload shell", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
  });
});
