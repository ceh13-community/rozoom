import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const watcherPages = [
  "pods-list/pods-list.svelte",
  "deployments-list.svelte",
  "daemon-sets-list.svelte",
  "stateful-sets-list.svelte",
  "replica-sets-list.svelte",
  "jobs-list.svelte",
  "cron-jobs-list.svelte",
];

describe("workload runtime status contract", () => {
  it("exposes an explicit Update action on watcher-based runtime status blocks", () => {
    for (const file of watcherPages) {
      const source = read(file);
      expect(source).toContain("<SectionRuntimeStatus");
      expect(source).toContain('secondaryActionLabel="Update"');
      expect(source).toContain("onSecondaryAction={");
    }
  });
});
