import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/widgets/datalists/ui/nodes-list/nodes-statuses-list.svelte"),
  "utf8",
);

describe("nodes workbench shell contract", () => {
  it("uses the shared multi-pane workbench shell", () => {
    expect(source).toContain("<MultiPaneWorkbench");
    expect(source).toContain("onReopenLastClosedTab");
    expect(source).toContain("Pane {paneIndex + 1}");
    expect(source).toContain("Select tab for pane {paneIndex + 1}");
  });
});
