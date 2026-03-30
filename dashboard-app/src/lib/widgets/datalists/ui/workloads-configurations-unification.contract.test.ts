import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

describe("workloads/configurations unification contract", () => {
  it("keeps shared key-value metadata expand in pages that require nested key/value rendering", () => {
    const files = ["deployments-list.svelte", "common/details-metadata-grid.svelte"];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain("KeyValueExpand");
      expect(source).toContain("<KeyValueExpand");
    }
  });

  it("reuses shared details metadata grid for primary details sheets", () => {
    const files = [
      "configuration-list.svelte",
      "nodes-list/data-sheet.svelte",
      "pods-list/data-sheet.svelte",
      "daemon-sets-list.svelte",
      "resource-details-sheet.svelte",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain("DetailsMetadataGrid");
      expect(source).toContain("<DetailsMetadataGrid");
    }
  });

  it("reuses shared details events block format", () => {
    const files = [
      "configuration-list.svelte",
      "nodes-list/data-sheet.svelte",
      "pods-list/data-sheet.svelte",
      "daemon-sets-list.svelte",
      "resource-details-sheet.svelte",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain("DetailsEventsList");
      expect(source).toContain("<DetailsEventsList");
    }
  });

  it("reuses shared details header actions on main interactive detail sheets", () => {
    const files = [
      "configuration-list.svelte",
      "nodes-list/data-sheet.svelte",
      "pods-list/data-sheet.svelte",
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "resource-details-sheet.svelte",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain("DetailsHeaderActions");
      expect(source).toContain("<DetailsHeaderActions");
    }
  });

  it("keeps configuration pages on the shared multi-pane workbench shell", () => {
    const source = read("configuration-list.svelte");
    expect(source).toContain(
      'import MultiPaneWorkbench from "$shared/ui/multi-pane-workbench.svelte";',
    );
    expect(source).toContain("<MultiPaneWorkbench");
    expect(source).not.toContain('import { WorkbenchHeader } from "$features/pods-workbench";');
    expect(source).not.toContain("<WorkbenchHeader");
  });
});
