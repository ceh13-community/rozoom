import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list table render contract", () => {
  it("renders the dedicated PR2 table directly without hotfix bypass flags", () => {
    expect(source).toContain("<DataTable");
    expect(source).toContain("rows={filteredRows}");
    expect(source).toContain("onOpenDetails={(row) => {");
    expect(source).not.toContain("ENABLE_PODS_TABLE_RENDER_HOTFIX");
  });
});
