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

describe("access control list routing contract", () => {
  it("routes the main rbac inventory pages through the shared configuration shell", () => {
    expect(workloadDisplaySource).toContain(
      'serviceaccounts: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'roles: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'rolebindings: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'clusterroles: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'clusterrolebindings: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps the shared configuration shell available for rbac inventories", () => {
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain("<TableToolbarShell");
    expect(configurationListSource).toContain("<MultiPaneWorkbench");
  });
});
