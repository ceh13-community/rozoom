import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");

describe("cluster page runtime control contract", () => {
  it("keeps page-level runtime status and tuning entry on the cluster header", () => {
    expect(source).toContain('import * as Popover from "$shared/ui/popover";');
    expect(source).toContain(
      'import ClusterRuntimeTuningPanel from "$widgets/cluster/ui/cluster-runtime-tuning-panel.svelte";',
    );
    expect(source).toContain(
      "const clusterRuntimeState = $derived(resolveClusterRuntimeState(cluster));",
    );
    expect(source).toContain(
      "const clusterRuntimeBudget = $derived(resolveClusterRuntimeBudgetForCluster(cluster));",
    );
    expect(source).toContain('title="Open cluster runtime controls"');
    expect(source).toContain("<ClusterRuntimeTuningPanel clusterId={cluster} />");
    expect(source).toContain("Override active");
    expect(source).toContain("Inheriting shared profile");
  });
});
