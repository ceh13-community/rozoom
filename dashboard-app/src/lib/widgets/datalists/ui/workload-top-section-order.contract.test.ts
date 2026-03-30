import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const pages = [
  { file: "pods-list/pods-list.svelte", workbenchMarker: "<PodWorkbenchPanel" },
  { file: "deployments-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
  { file: "daemon-sets-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
  { file: "stateful-sets-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
  { file: "replica-sets-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
  { file: "jobs-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
  { file: "cron-jobs-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
  { file: "nodes-list/nodes-statuses-list.svelte", workbenchMarker: "<MultiPaneWorkbench" },
];

describe("workload top section order contract", () => {
  it("keeps workbench, selection shell, summary and table in a consistent order", () => {
    for (const page of pages) {
      const source = read(page.file);
      const workbenchIndex = source.indexOf(page.workbenchMarker);
      const selectionIndex = source.indexOf("<WorkloadSelectionBar");
      const summaryIndex = source.indexOf("<ResourceSummaryStrip");
      const tableIndex = source.indexOf("<DataTable");

      expect(workbenchIndex).toBeGreaterThan(-1);
      expect(selectionIndex).toBeGreaterThan(-1);
      expect(summaryIndex).toBeGreaterThan(-1);
      expect(tableIndex).toBeGreaterThan(-1);
      expect(workbenchIndex).toBeLessThan(selectionIndex);
      expect(selectionIndex).toBeLessThan(summaryIndex);
      expect(summaryIndex).toBeLessThan(tableIndex);
    }
  });
});
