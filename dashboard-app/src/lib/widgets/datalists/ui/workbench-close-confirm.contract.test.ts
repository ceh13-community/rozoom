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
  it("asks only for unsaved YAML, offers Undo, and never closes tabs on a layout change", () => {
    for (const file of files) {
      const source = read(file);
      expect(source).toContain("async function closeWorkbenchTab(");
      expect(source).toContain("options: { skipConfirm?: boolean } = {}");
      expect(source).toContain("if (!options.skipConfirm) {");
      expect(source).toContain(
        'hasUnsavedChanges: closingTab.kind === "yaml" && hasUnsavedYaml(getYamlTab(tabId)),',
      );
      // Undo reopens the entry this close remembered, never the top of the stack.
      expect(source).toContain("undoForClosedTab(closeTarget, closedEntry, reopenClosedTab)");
      expect(source).toContain("function reopenClosedTab(wanted: ClosedWorkbenchTab | undefined)");
      expect(source).not.toContain("() => void reopenLastClosedTab()");
      expect(source).not.toContain("void closeWorkbenchTab(tabId, { skipConfirm: true });");
      expect(source).not.toContain("confirmWorkbenchLayoutShrink");
      expect(source).toContain(
        "// Fewer panes only hides panes: their tabs stay in the tab strip.",
      );
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
