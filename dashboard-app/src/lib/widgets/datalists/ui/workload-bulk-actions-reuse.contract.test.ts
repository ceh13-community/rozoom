import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const files = [
  "src/lib/widgets/datalists/ui/deployments-list/deployment-bulk-actions.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list/daemonset-bulk-actions.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list/statefulset-bulk-actions.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list/replicaset-bulk-actions.svelte",
  "src/lib/widgets/datalists/ui/jobs-list/job-bulk-actions.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list/cronjob-bulk-actions.svelte",
];

describe("workload bulk actions reuse contract", () => {
  it("reuses shared WorkloadBulkActions component across workload lists", () => {
    for (const path of files) {
      const source = readFileSync(resolve(path), "utf8");
      expect(source).toContain("import WorkloadBulkActions");
      expect(source).toContain("<WorkloadBulkActions");
    }
  });
});
