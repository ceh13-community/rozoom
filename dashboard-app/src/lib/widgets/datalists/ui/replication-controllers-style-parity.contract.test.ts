import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);

describe("replication controllers style parity contract", () => {
  it("keeps the shared top-section rhythm used by workload pages", () => {
    const workbenchIndex = source.indexOf("<MultiPaneWorkbench");
    const selectionIndex = source.indexOf("<WorkloadSelectionBar");
    const summaryStripIndex = source.indexOf("<ResourceSummaryStrip");
    const runtimeIndex = source.indexOf("<SectionRuntimeStatus");
    const toolbarIndex = source.indexOf("<TableToolbarShell");
    const tableIndex = source.indexOf("<TableSurface");

    expect(workbenchIndex).toBeGreaterThan(-1);
    expect(selectionIndex).toBeGreaterThan(-1);
    expect(summaryStripIndex).toBeGreaterThan(-1);
    expect(runtimeIndex).toBeGreaterThan(-1);
    expect(toolbarIndex).toBeGreaterThan(-1);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(workbenchIndex).toBeLessThan(selectionIndex);
    expect(selectionIndex).toBeLessThan(summaryStripIndex);
    expect(summaryStripIndex).toBeLessThan(runtimeIndex);
    expect(runtimeIndex).toBeLessThan(toolbarIndex);
    expect(toolbarIndex).toBeLessThan(tableIndex);
  });
});
