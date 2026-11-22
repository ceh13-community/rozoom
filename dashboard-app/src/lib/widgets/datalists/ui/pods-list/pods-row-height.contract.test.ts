import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Pods table is virtualized with a fixed row height. If a row grew taller than that
// height (a wrapped name, a taller control), rows would drift out of the virtual window.
// Rows have a fixed height that is the same number.
describe("Pods row height", () => {
  it("VIRTUAL_ROW_HEIGHT equals the fixed height of every row", () => {
    const source = readFileSync(resolve(__dirname, "data-table.svelte"), "utf8");
    const height = /const VIRTUAL_ROW_HEIGHT = (\d+);/.exec(source)?.[1];
    expect(height).toBeDefined();
    const rows = source.match(/pods-k9s-table__row [^`"]*/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row).toContain(`h-[${height}px]`);
      expect(row).toContain("overflow-hidden");
    }
  });
});
