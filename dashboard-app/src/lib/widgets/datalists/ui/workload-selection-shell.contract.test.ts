import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const selectionPages = [
  "deployments-list.svelte",
  "daemon-sets-list.svelte",
  "stateful-sets-list.svelte",
  "replica-sets-list.svelte",
  "jobs-list.svelte",
  "cron-jobs-list.svelte",
];

describe("workload selection shell contract", () => {
  it("keeps watcher-based workload pages on the shared selection shell", () => {
    for (const file of selectionPages) {
      const source = read(file);
      expect(source).toContain(
        'import WorkloadSelectionBar from "./common/workload-selection-bar.svelte";',
      );
      expect(source).toContain("<WorkloadSelectionBar");
    }
  });
});
