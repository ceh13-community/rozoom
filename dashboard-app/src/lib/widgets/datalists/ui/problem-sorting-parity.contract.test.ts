import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dataTableFiles = [
  "nodes-list/data-table.svelte",
  "deployments-list/data-table.svelte",
  "daemon-sets-list/data-table.svelte",
  "stateful-sets-list/data-table.svelte",
  "replica-sets-list/data-table.svelte",
  "jobs-list/data-table.svelte",
  "cron-jobs-list/data-table.svelte",
];

const problemColumnDefinitionFiles = [
  "pods-list/columns.ts",
  "nodes-list/columns.ts",
  "deployments-list.svelte",
  "daemon-sets-list.svelte",
  "stateful-sets-list.svelte",
  "replica-sets-list.svelte",
  "jobs-list.svelte",
  "cron-jobs-list.svelte",
];

describe("problem sorting parity", () => {
  it("uses problem-first sorting defaults and hides helper column from exports", () => {
    for (const relativePath of dataTableFiles) {
      const absolute = resolve("src/lib/widgets/datalists/ui", relativePath);
      const source = readFileSync(absolute, "utf8");

      expect(source).toContain(
        'let sorting = $state<SortingState>([{ id: "problemScore", desc: true }])',
      );
      expect(source).toContain("problemScore: false");
      expect(source).toContain('["problemScore", "select", "actions"]');
    }
  });

  it("declares hidden problemScore column in each workload table", () => {
    for (const relativePath of problemColumnDefinitionFiles) {
      const absolute = resolve("src/lib/widgets/datalists/ui", relativePath);
      const source = readFileSync(absolute, "utf8");

      expect(source).toContain('id: "problemScore"');
      expect(source).toContain("enableHiding: false");
    }
  });
});
