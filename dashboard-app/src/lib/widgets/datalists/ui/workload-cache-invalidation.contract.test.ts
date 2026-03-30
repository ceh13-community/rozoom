import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workloadMutationFiles = [
  "src/lib/widgets/datalists/ui/deployments-list.svelte",
  "src/lib/widgets/datalists/ui/configuration-list.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
  "src/lib/widgets/datalists/ui/jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
] as const;

describe("workload cache invalidation contract", () => {
  it("keeps shared workload cache invalidation helper wired in mutation-heavy workload pages", () => {
    for (const file of workloadMutationFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain('from "./common/workload-cache-invalidation"');
      expect(source).toContain("invalidateWorkloadSnapshotCache(");
    }
  });
});
