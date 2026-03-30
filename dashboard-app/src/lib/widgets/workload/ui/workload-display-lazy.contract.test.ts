import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REGISTRY_PATH = resolve(
  process.cwd(),
  "src/lib/widgets/workload/model/workload-route-registry.ts",
);
const DISPLAY_PATH = resolve(process.cwd(), "src/lib/widgets/workload/ui/workload-display.svelte");

describe("workload display lazy-loading contract", () => {
  it("uses dynamic imports per workload panel", () => {
    const registrySource = readFileSync(REGISTRY_PATH, "utf8");
    const displaySource = readFileSync(DISPLAY_PATH, "utf8");
    expect(registrySource).toContain(
      'overview: () => import("$widgets/datalists/ui/overview.svelte")',
    );
    expect(registrySource).toContain(
      'pods: () => import("$widgets/datalists/ui/pods-list/pods-list.svelte")',
    );
    expect(registrySource).toContain(
      'deployments: () => import("$widgets/datalists/ui/deployments-list.svelte")',
    );
    expect(displaySource).toContain(
      "<WorkloadComponent data={{ ...workloadProps, uuid: clusterId }} />",
    );
  });
});
