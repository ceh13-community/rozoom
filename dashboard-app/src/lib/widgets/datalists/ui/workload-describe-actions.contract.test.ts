import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

describe("workload describe actions contract", () => {
  it("exposes copy describe and debug describe actions in row and bulk menus for non-pod workloads", () => {
    const files = [
      "deployments-list/deployment-actions-menu.svelte",
      "deployments-list/deployment-bulk-actions.svelte",
      "daemon-sets-list/daemonset-actions-menu.svelte",
      "daemon-sets-list/daemonset-bulk-actions.svelte",
      "stateful-sets-list/statefulset-actions-menu.svelte",
      "stateful-sets-list/statefulset-bulk-actions.svelte",
      "replica-sets-list/replicaset-actions-menu.svelte",
      "replica-sets-list/replicaset-bulk-actions.svelte",
      "jobs-list/job-actions-menu.svelte",
      "jobs-list/job-bulk-actions.svelte",
      "cron-jobs-list/cronjob-actions-menu.svelte",
      "cron-jobs-list/cronjob-bulk-actions.svelte",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain("onCopyDescribe");
      expect(source).toContain("onRunDebugDescribe");
      expect(source).toContain("Copy kubectl describe");
      expect(source).toContain("Run debug describe");
    }
  });

  it("wires describe callbacks from workload list pages and details sheet", () => {
    const listFiles = [
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "stateful-sets-list.svelte",
      "replica-sets-list.svelte",
      "jobs-list.svelte",
      "cron-jobs-list.svelte",
    ];

    for (const file of listFiles) {
      const source = read(file);
      expect(source).toContain("buildKubectlDescribeCommand");
      expect(source).toContain("onCopyDescribe");
      expect(source).toContain("onRunDebugDescribe");
    }

    const detailsSource = read("resource-details-sheet.svelte");
    expect(detailsSource).toContain("onCopyDescribe");
    expect(detailsSource).toContain("onRunDebugDescribe");
    expect(detailsSource).toContain('title: "Copy kubectl describe"');
    expect(detailsSource).toContain('title: "Run debug describe"');
  });
});
