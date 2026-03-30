import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const stickyGridPages = ["network/network-list.svelte"];

const tableSurfacePages = [
  "triage/global-triage-panel.svelte",
  "network/network-list.svelte",
  "replication-controllers-list.svelte",
];

describe("section summary shell contract", () => {
  it("keeps route-scoped table pages on TableSummaryBar", () => {
    for (const file of [...stickyGridPages, ...tableSurfacePages]) {
      const source = read(file);
      expect(source).toMatch(/TableSummaryBar|TableSummaryFilterBar/);
    }
  });

  it("keeps metadata-first route-scoped pages on the sticky grid contract", () => {
    for (const file of stickyGridPages) {
      const source = read(file);
      expect(source).toContain("sticky-table-header");
      expect(source).toContain("text-xs font-medium uppercase tracking-wide text-muted-foreground");
    }
  });

  it("keeps route-scoped table pages on TableSurface where expected", () => {
    for (const file of tableSurfacePages) {
      const source = read(file);
      expect(source).toContain("TableSurface");
    }
  });
});
