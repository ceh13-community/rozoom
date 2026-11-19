import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// setInitialCronJobs runs inside an effect and the store calls the list's subscriber right
// there. The subscriber reads cronJobsSnapshot (to keep next-run hints) and writes it, so a
// tracked subscriber made that effect rerun on its own write: after Jobs, opening CronJobs
// ended in effect_update_depth_exceeded and a blank page.
describe("CronJobs sync store subscription", () => {
  const source = readFileSync(resolve(__dirname, "cron-jobs-list.svelte"), "utf8");
  const start = source.indexOf("function bindCronJobsSyncStore(");
  const body = source.slice(start, source.indexOf("\n  }\n", start));

  it("binds the sync store with an untracked subscriber", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("subscribeUntracked(selectClusterCronJobs(clusterId)");
    expect(body).not.toContain(".subscribe(");
  });

  it("still seeds the store from an effect, which is why the subscriber must be untracked", () => {
    expect(source).toMatch(
      /\$effect\(\(\) => \{\s*if \(!data\?\.slug\) return;\s*setInitialCronJobs\(/,
    );
  });
});
