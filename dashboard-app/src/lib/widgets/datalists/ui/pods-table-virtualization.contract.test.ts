import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/data-table.svelte"),
  "utf8",
);

describe("pods table PR3 contract", () => {
  it("renders a searchable table with watcher, selection, and opt-in metrics controls", () => {
    expect(source).toContain('placeholder="Filter pods..."');
    expect(source).toContain('Watcher: <span class="font-medium text-foreground"');
    expect(source).toContain('{watcherEnabled ? "Active" : "Paused"}');
    expect(source).toContain('{enrichedTableEnabled ? "Hide live usage" : "Show live usage"}');
    expect(source).toContain('label="Select all pods"');
    expect(source).not.toContain("showRefreshButton={true}");
    expect(source).toContain("{onResetWatcherSettings}");
  });

  it("keeps actions and selection in the base table while advanced workbench stays external", () => {
    expect(source).toContain(">Actions<");
    expect(source).toContain('label="Name"');
    expect(source).toContain('label="Namespace"');
    expect(source).toContain('label="Status"');
    expect(source).toContain('label="Ready"');
    expect(source).toContain('label="Restarts"');
    expect(source).toContain('label="Node"');
    expect(source).toContain('label="Age"');
  });
});
