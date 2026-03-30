import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const files = [
  "pods-list/data-table.svelte",
  "deployments-list/data-table.svelte",
  "daemon-sets-list/data-table.svelte",
  "stateful-sets-list/data-table.svelte",
  "replica-sets-list/data-table.svelte",
  "jobs-list/data-table.svelte",
  "cron-jobs-list/data-table.svelte",
];
const nodeGroupingFiles = new Set([
  "pods-list/data-table.svelte",
  "deployments-list/data-table.svelte",
]);

describe("workload table toolbar parity", () => {
  it("keeps watcher controls and empty-state row aligned across new workload pages", () => {
    for (const file of files) {
      const source = read(file);
      expect(source).toContain(
        'import WatcherToolbarControls from "../watcher-toolbar-controls.svelte";',
      );
      expect(source).toContain('import TableToolbarShell from "../table-toolbar-shell.svelte";');
      expect(source).toContain("<TableToolbarShell");
      expect(source).toContain("<WatcherToolbarControls");
      expect(source).toContain("{watcherEnabled}");
      expect(source).toContain("{watcherRefreshSeconds}");
      expect(source).toContain("{onToggleWatcher}");
      expect(source).toContain("{onWatcherRefreshSecondsChange}");
      expect(source).toContain("{onResetWatcherSettings}");
      expect(source).toContain("max-w-xl");
      if (nodeGroupingFiles.has(file)) {
        expect(source).toContain('title="Group by node"');
      }

      if (file === "pods-list/data-table.svelte") {
        expect(source).toContain("max-h-[70vh]");
        expect(source).toContain("rounded-lg border border-border/60 bg-background/40");
        expect(source).toContain("No pods found for the current filter.");
        expect(source).toContain("Show live usage");
        expect(source).toContain('title="Flat list"');
        expect(source).toContain('title="Group by namespace"');
        expect(source).toContain("Download CSV");
        expect(source).toContain("TableChecklistDropdown");
        expect(source).toContain("label={`NS (");
        expect(source).toContain('label="Columns"');
        continue;
      }

      expect(source).toContain('import TableSurface from "$shared/ui/table-surface.svelte";');
      expect(source).toContain("<TableSurface");
      expect(source).toContain("No results.");
      expect(source).toContain('title="Flat list"');
      expect(source).toContain('title="Group by namespace"');
      expect(source).toContain("Download CSV");
      expect(source).toContain("TableChecklistDropdown");
      expect(source).toContain("label={`NS (");
      expect(source).toContain('label="Columns"');
    }
  });
});
