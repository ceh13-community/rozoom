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

describe("namespaces list routing contract", () => {
  it("routes namespaces through the shared workload-reference configuration boundary", () => {
    expect(workloadDisplaySource).toContain(
      'namespaces: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'namespaces: { ...data, items: workloadData, workloadKey: "namespaces" }',
    );
  });

  it("keeps namespaces inside the shared configuration shell", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain('namespaces: "Namespaces"');
    expect(configurationListSource).toContain('namespaces: "namespaces"');
  });
});
