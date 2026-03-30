import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/workload-simple-workbench.svelte"),
  "utf8",
);

describe("workload simple workbench contract", () => {
  it("keeps pods-like tab strip controls for logs and yaml", () => {
    expect(source).toContain("MultiPaneWorkbench");
    expect(source).toContain("onReopenLastClosedTab={reopenLastClosedTab}");
    expect(source).toContain("onTogglePin={(tabId) => {");
    expect(source).toContain("onLayoutChange={(nextLayout) => {");
  });

  it("persists active tab state", () => {
    expect(source).toContain("activeTabId");
    expect(source).toContain("parsed.activeTabId");
    expect(source).toContain("pinnedTabIds");
    expect(source).toContain("closedTabs");
    expect(source).toContain("if (paneIndex === 0 && nextTab)");
  });
});
