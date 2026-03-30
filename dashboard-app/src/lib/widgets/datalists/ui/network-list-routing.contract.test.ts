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

describe("network list routing contract", () => {
  it("routes service-oriented network sections through the shared workload-reference boundary", () => {
    expect(workloadDisplaySource).toContain(
      'services: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'endpoints: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'endpointslices: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps services and endpoints inside the shared workload shell", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("TableToolbarShell");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
  });
});
