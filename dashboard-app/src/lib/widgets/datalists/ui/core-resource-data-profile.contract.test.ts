import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const nodesSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/nodes-list/nodes-statuses-list.svelte"),
  "utf8",
);

describe("core resource data profile contract", () => {
  it("routes pods sync and diagnostics through the shared dashboard data profile", () => {
    expect(podsSource).toContain('from "$shared/lib/dashboard-data-profile.svelte"');
    expect(podsSource).toContain("dashboardDataProfile");
    expect(podsSource).toContain("getDashboardDataProfileDisplayName");
    expect(podsSource).toContain("podsRuntimeProfileLabel");
  });

  it("routes nodes sync and derived polling through the shared dashboard data profile", () => {
    expect(nodesSource).toContain('from "$shared/lib/dashboard-data-profile.svelte"');
    expect(nodesSource).toContain("const nodesResourceSyncPolicy = $derived.by(() =>");
    expect(nodesSource).toContain("const nodesDerivedRefreshPolicy = $derived.by(() =>");
    expect(nodesSource).toContain(
      "startNodesHealthPolling(clusterId, nodesDerivedRefreshPolicy.refreshSeconds * 1000);",
    );
    expect(nodesSource).toContain(
      'if (nodesResourceSyncPolicy.enabled && nodesResourceSyncPolicy.mode === "stream") {',
    );
  });
});
