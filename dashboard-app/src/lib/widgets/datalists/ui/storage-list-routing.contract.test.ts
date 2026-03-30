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

describe("storage list routing contract", () => {
  it("routes pvc sections through the shared workload-reference boundary", () => {
    expect(workloadDisplaySource).toContain(
      'persistentvolumeclaims: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'volumeattributesclasses: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'volumesnapshots: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'volumesnapshotcontents: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'volumesnapshotclasses: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'csistoragecapacities: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps pvc pages inside the shared workload shell", () => {
    expect(configurationListSource).toContain("MultiPaneWorkbench");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain("persistentvolumeclaims");
  });
});
