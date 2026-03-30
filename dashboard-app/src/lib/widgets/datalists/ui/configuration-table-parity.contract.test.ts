import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configurationListSource = readFileSync(
  resolve(process.cwd(), "src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);
const actionsMenuSource = readFileSync(
  resolve(
    process.cwd(),
    "src/lib/widgets/datalists/ui/configuration-list/configuration-actions-menu.svelte",
  ),
  "utf8",
);

describe("configuration table parity contract", () => {
  it("uses the shared table surface and exposes workload-style selection and actions affordances", () => {
    expect(configurationListSource).toContain(
      'import TableSurface from "$shared/ui/table-surface.svelte";',
    );
    expect(configurationListSource).toContain("<TableSurface");
    expect(configurationListSource).toContain("bind:ref={tableScrollHost}");
    expect(configurationListSource).toContain('label="Select all rows"');
    expect(configurationListSource).toContain("ConfigurationActionsMenu");
    expect(configurationListSource).toContain("WorkloadSelectionBar");
    expect(configurationListSource).toContain("count={selectedRows.length}");
    expect(configurationListSource).toContain("ResourceSummaryStrip");
    expect(configurationListSource).toContain("<ResourceSummaryStrip");
    expect(configurationListSource).toContain("label={`Select namespace ${group}`}");
    expect(configurationListSource).toContain(
      "toggleGroupSelection(next, getNamespaceRows(group))",
    );
    expect(configurationListSource).toContain(">Actions</span>");
    expect(actionsMenuSource).toContain("Show details");
  });

  it("keeps configuration top sections aligned with workload page order", () => {
    const workbenchIndex = configurationListSource.indexOf("<MultiPaneWorkbench");
    const selectionIndex = configurationListSource.indexOf("<WorkloadSelectionBar");
    const summaryIndex = configurationListSource.indexOf("<ResourceSummaryStrip");
    const runtimeIndex = configurationListSource.indexOf("<SectionRuntimeStatus");
    const toolbarIndex = configurationListSource.indexOf("<TableToolbarShell");
    const tableIndex = configurationListSource.indexOf("<TableSurface");

    expect(workbenchIndex).toBeGreaterThan(-1);
    expect(selectionIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(runtimeIndex).toBeGreaterThan(-1);
    expect(toolbarIndex).toBeGreaterThan(-1);
    expect(tableIndex).toBeGreaterThan(-1);
    expect(workbenchIndex).toBeLessThan(selectionIndex);
    expect(selectionIndex).toBeLessThan(summaryIndex);
    expect(summaryIndex).toBeLessThan(runtimeIndex);
    expect(runtimeIndex).toBeLessThan(toolbarIndex);
    expect(toolbarIndex).toBeLessThan(tableIndex);
  });

  it("uses workload-specific runtime labels instead of generic configuration copy", () => {
    expect(configurationListSource).toContain(
      "const configurationRuntimeSectionLabel = $derived(`${tableTitle} Runtime Status`)",
    );
    expect(configurationListSource).toContain(
      "const configurationRuntimeSubjectLabel = $derived.by(() => {",
    );
    expect(configurationListSource).toContain(
      "Streaming watcher active for ${configurationRuntimeSubjectLabel}.",
    );
    expect(configurationListSource).toContain(
      "Polling ${configurationRuntimeSubjectLabel} every ${watcherPolicy.refreshSeconds}s.",
    );
    expect(configurationListSource).toContain("sectionLabel={configurationRuntimeSectionLabel}");
    expect(configurationListSource).not.toContain('sectionLabel="Configuration Runtime Status"');
  });

  it("keeps toolbar controls aligned with workload pages by omitting configuration-only view controls", () => {
    expect(configurationListSource).not.toContain(
      '<div class="text-xs text-muted-foreground">Saved view</div>',
    );
    expect(configurationListSource).not.toContain(
      '<div class="text-xs text-muted-foreground">Save current</div>',
    );
    expect(configurationListSource).not.toContain('aria-label="Quick filter"');
    expect(configurationListSource).not.toContain('aria-label="Sort preset"');
    expect(configurationListSource).not.toContain(
      '<Button variant="outline" size="sm" onclick={copyShareLink}>Copy link</Button>',
    );
  });
});
