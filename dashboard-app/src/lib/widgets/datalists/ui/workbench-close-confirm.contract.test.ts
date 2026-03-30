import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const files = [
  "deployments-list.svelte",
  "daemon-sets-list.svelte",
  "stateful-sets-list.svelte",
  "replica-sets-list.svelte",
  "jobs-list.svelte",
  "cron-jobs-list.svelte",
];

const filesWithAutoRecovery = [
  "stateful-sets-list.svelte",
  "replica-sets-list.svelte",
  "jobs-list.svelte",
  "cron-jobs-list.svelte",
];

describe("workbench close confirm parity", () => {
  it("requires close confirmation for logs/yaml tabs and skips duplicate prompts on layout changes", () => {
    for (const file of files) {
      const source = read(file);
      expect(source).toContain("async function closeWorkbenchTab(");
      expect(source).toContain("options: { skipConfirm?: boolean } = {}");
      expect(source).toContain(
        'if (!options.skipConfirm && (closingTab.kind === "logs" || closingTab.kind === "yaml"))',
      );
      expect(source).toContain("confirmWorkbenchTabClose(closingTab)");
      expect(source).toContain("confirmWorkbenchLayoutShrink");
      expect(source).toContain("await closeWorkbenchTab(tabId, { skipConfirm: true })");
    }
    expect(read("workload-simple-workbench.svelte")).toContain("confirmWorkbenchTabClose");
    expect(read("pods-list/pod-workbench-panel.svelte")).toContain("confirmWorkbenchTabClose");
  });

  it("does not auto-restore immediately after user closes the final tab", () => {
    for (const file of filesWithAutoRecovery) {
      const source = read(file);
      expect(source).toContain("if (remaining");
      expect(source).toContain("workbenchRecoveryAttemptedKey = data?.slug ?? null;");
    }
  });
});
