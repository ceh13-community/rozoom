import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

describe("workloads/configuration smoke contract", () => {
  it("keeps details open flows wired from list actions", () => {
    const legacyDetailsFiles = [
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "configuration-list.svelte",
    ];
    for (const file of legacyDetailsFiles) {
      const source = read(file);
      expect(source).toContain("onShowDetails");
    }
    expect(read("pods-list/pods-list.svelte")).toContain("openDetails(");
  });

  it("keeps edit yaml entry points wired from actions and details headers", () => {
    const files = [
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "stateful-sets-list.svelte",
      "replica-sets-list.svelte",
      "jobs-list.svelte",
      "cron-jobs-list.svelte",
      "configuration-list.svelte",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).toContain("openYaml");
    }
    const podsSource = read("pods-list/pods-list.svelte");
    expect(podsSource).toContain('openWorkbench("yaml"');
    expect(podsSource).toContain("onEditYaml");
  });

  it("keeps confirm dialogs for tab close and pane layout changes", () => {
    const files = [
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "stateful-sets-list.svelte",
      "replica-sets-list.svelte",
      "jobs-list.svelte",
      "cron-jobs-list.svelte",
      "configuration-list.svelte",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).toContain("confirmWorkbenchTabClose");
      expect(source).toContain("computeLayoutClosePlan");
    }
    expect(read("pods-list/pods-list.svelte")).toContain("confirmAction");
  });

  it("keeps workbench persistence and restore hooks across pages", () => {
    const workloadFiles = [
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "stateful-sets-list.svelte",
      "replica-sets-list.svelte",
      "jobs-list.svelte",
      "cron-jobs-list.svelte",
    ];
    for (const file of workloadFiles) {
      const source = read(file);
      expect(source).toContain("workbenchStateRestored");
      expect(source).toContain("persistWorkbenchState");
      expect(source).toContain("pendingWorkbenchState");
    }
    const podsSource = read("pods-list/pods-list.svelte");
    expect(podsSource).toContain("workbenchRequest");
    expect(podsSource).toContain("openWorkbench(");
    const configuration = read("configuration-list.svelte");
    expect(configuration).toContain("workbenchStateRestored");
    expect(configuration).toContain("persistWorkbenchUiSettings");
    expect(configuration).toContain("pendingRestoredTabs");
  });
});
