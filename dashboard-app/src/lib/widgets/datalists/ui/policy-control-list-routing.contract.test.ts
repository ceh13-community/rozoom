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

describe("policy control list routing contract", () => {
  it("routes policy and control workloads through the shared configuration workbench boundary", () => {
    expect(workloadDisplaySource).toContain("horizontalpodautoscalers:");
    expect(workloadDisplaySource).toContain("validatingwebhookconfigurations:");
    expect(workloadDisplaySource).toContain("priorityclasses:");
    expect(workloadDisplaySource).toContain(
      'horizontalpodautoscalers: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'priorityclasses: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
    expect(workloadDisplaySource).toContain(
      'validatingwebhookconfigurations: () => import("$widgets/datalists/ui/configuration-list.svelte")',
    );
  });

  it("keeps policy/control workloads on the richer workload-style configuration surface", () => {
    expect(configurationListSource).toContain("ConfigurationActionsMenu");
    expect(configurationListSource).toContain("WorkloadSelectionBar");
    expect(configurationListSource).toContain("SectionRuntimeStatus");
    expect(configurationListSource).toContain("MultiPaneWorkbench");
  });
});
