import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/widgets/datalists/ui/pods-list/pod-workbench-panel.svelte"),
  "utf8",
);

describe("pods workbench shell contract", () => {
  it("keeps pods on the shared multi-pane body contract with pane shell and metrics summary", () => {
    expect(source).toContain("<MultiPaneWorkbench");
    expect(source).toContain('class="flex min-h-0 flex-1 gap-2"');
    expect(source).toContain("<ResourceMetricsBadge");
    expect(source).toContain("No metrics available for this pod.");
    expect(source).toContain("border-dashed border-border");
    expect(source).toContain("Pane {paneIndex + 1}");
  });
});
