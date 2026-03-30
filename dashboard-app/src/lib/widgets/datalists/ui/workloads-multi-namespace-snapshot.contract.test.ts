import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const watcherFiles = [
  "src/lib/widgets/datalists/ui/deployments-list.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
  "src/lib/widgets/datalists/ui/jobs-list.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
];

describe("workloads multi-namespace snapshot contract", () => {
  it("uses shared namespaced snapshot helper for watcher refreshes", () => {
    for (const file of watcherFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).toContain("fetchNamespacedSnapshotItems");
      expect(source).not.toContain('--all-namespaces", "-o", "json');
    }
  });
});
