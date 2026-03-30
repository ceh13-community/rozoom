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

describe("secrets list routing contract", () => {
  it("routes secrets through the shared configuration workbench boundary", () => {
    expect(workloadDisplaySource).toContain(
      'secrets: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'secrets: { ...data, items: workloadData, workloadKey: "secrets" }',
    );
  });

  it("keeps secrets on the richer workload-style configuration surface", () => {
    expect(configurationListSource).toContain("ConfigurationActionsMenu");
    expect(configurationListSource).toContain("WorkloadSelectionBar");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain("MultiPaneWorkbench");
  });
});
