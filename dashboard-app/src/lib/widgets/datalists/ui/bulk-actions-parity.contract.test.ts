import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

describe("bulk actions parity contract", () => {
  it("keeps shared core actions aligned for all workload bulk toolbars", () => {
    const sources = [
      read("deployments-list/deployment-bulk-actions.svelte"),
      read("daemon-sets-list/daemonset-bulk-actions.svelte"),
      read("stateful-sets-list/statefulset-bulk-actions.svelte"),
      read("replica-sets-list/replicaset-bulk-actions.svelte"),
      read("jobs-list/job-bulk-actions.svelte"),
      read("cron-jobs-list/cronjob-bulk-actions.svelte"),
    ];

    for (const source of sources) {
      expect(source).toContain("WorkloadBulkActions");
      expect(source).toContain('label: "Show details"');
      expect(source).toContain('label: "Edit YAML"');
      expect(source).toContain('label: "Download YAML"');
      expect(source).toContain("destructive: true");
    }
  });

  it("keeps scale action available for scalable workload types", () => {
    const deployments = read("deployments-list/deployment-bulk-actions.svelte");
    const statefulSets = read("stateful-sets-list/statefulset-bulk-actions.svelte");
    const replicaSets = read("replica-sets-list/replicaset-bulk-actions.svelte");

    for (const source of [deployments, statefulSets, replicaSets]) {
      expect(source).toContain('id: "scale"');
    }

    const daemonSets = read("daemon-sets-list/daemonset-bulk-actions.svelte");
    expect(daemonSets).not.toContain('id: "scale"');
  });

  it("keeps workload-specific actions intentional", () => {
    const jobs = read("jobs-list/job-bulk-actions.svelte");
    const cronJobs = read("cron-jobs-list/cronjob-bulk-actions.svelte");

    expect(jobs).toContain('label: "Logs"');
    expect(jobs).toContain('title: "Investigate"');
    expect(jobs).not.toContain('label: "Rollout restart"');

    expect(cronJobs).toContain('label: "Trigger cron job now"');
    expect(cronJobs).toContain("Suspend cron job schedule");
    expect(cronJobs).toContain("Resume cron job schedule");
    expect(cronJobs).toContain('label: "Logs"');
    expect(cronJobs).toContain('title: "Investigate"');
    expect(cronJobs).not.toContain('label: "Rollout restart"');
  });
});
