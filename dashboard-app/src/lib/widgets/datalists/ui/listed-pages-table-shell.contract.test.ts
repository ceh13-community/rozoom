import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const sharedTablePages = [
  "nodes-list/data-table.svelte",
  "deployments-list/data-table.svelte",
  "daemon-sets-list/data-table.svelte",
  "stateful-sets-list/data-table.svelte",
  "replica-sets-list/data-table.svelte",
  "jobs-list/data-table.svelte",
  "cron-jobs-list/data-table.svelte",
  "triage/global-triage-panel.svelte",
  "configuration-list.svelte",
];

const gridTablePages = ["pods-list/data-table.svelte", "network/network-list.svelte"];

describe("listed pages table shell contract", () => {
  it("keeps shared Table pages on the common table shell", () => {
    for (const file of sharedTablePages) {
      const source = read(file);
      expect(source).toMatch(/TableSurface|Table\.TableHead|Table\.Head/);
      if (file === "triage/global-triage-panel.svelte") {
        expect(source).toContain("TableSummaryBar");
      }
    }
  });

  it("keeps grid table pages on the shared sticky header contract", () => {
    for (const file of gridTablePages) {
      const source = read(file);
      expect(source).toContain("sticky-table-header");
      expect(source).toContain("text-xs font-medium uppercase tracking-wide text-muted-foreground");
      if (file === "network/network-list.svelte") {
        expect(source).toMatch(/TableSummaryBar|TableSummaryFilterBar/);
      }
    }
  });
});
