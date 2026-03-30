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

describe("configuration core list routing contract", () => {
  it("routes core configuration workloads through the shared configuration workbench boundary", () => {
    expect(workloadDisplaySource).toContain("configmaps:");
    expect(workloadDisplaySource).toContain("resourcequotas:");
    expect(workloadDisplaySource).toContain("limitranges:");
    expect(workloadDisplaySource).toContain("leases:");
    expect(workloadDisplaySource).toContain(
      'configmaps: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'resourcequotas: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'limitranges: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'leases: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps core configuration workloads on the richer workload-style configuration surface", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("ConfigurationActionsMenu");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
  });
});
