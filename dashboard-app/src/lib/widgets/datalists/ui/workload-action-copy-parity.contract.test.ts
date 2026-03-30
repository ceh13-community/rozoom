import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

describe("workload action copy parity", () => {
  it("uses human-readable action wording across new workload pages", () => {
    const statefulSets = read("stateful-sets-list.svelte");
    const replicaSets = read("replica-sets-list.svelte");
    const jobs = read("jobs-list.svelte");
    const cronJobs = read("cron-jobs-list.svelte");

    expect(statefulSets).toContain("stateful set");
    expect(replicaSets).toContain("replica set");
    expect(jobs).not.toContain("Rollout restart is not supported for jobs.");
    expect(cronJobs).toContain("Triggered");
    expect(cronJobs).toContain("Resumed");
    expect(cronJobs).toContain("Suspended");
    expect(cronJobs).toContain("cron job");

    for (const source of [statefulSets, replicaSets, jobs, cronJobs]) {
      expect(source).toContain('import { confirmAction } from "$shared/lib/confirm-action";');
      expect(source).toContain("const confirmed = await confirmAction(");
      expect(source).toContain('"Confirm delete"');
    }
  });
});
