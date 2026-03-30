import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tanstackTableFiles = [
  "src/lib/widgets/datalists/ui/workloads-table.svelte",
  "src/lib/widgets/datalists/ui/cronjobs-health/data-table.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/deployments-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/jobs-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/nodes-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/nodes-pressures/data-table.svelte",
  "src/lib/widgets/datalists/ui/pods-restarts/data-table.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list/data-table.svelte",
];

const routeBackedStaticTables = [
  "src/lib/widgets/datalists/ui/pods-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/custom-resources/custom-resources-list.svelte",
  "src/lib/widgets/datalists/ui/network/port-forwarding-panel.svelte",
  "src/lib/widgets/datalists/ui/replication-controllers-list.svelte",
  "src/lib/widgets/datalists/ui/triage/global-triage-panel.svelte",
];

describe("table sorting standardization", () => {
  it("routes tanstack tables through the shared sortable header cell", () => {
    for (const file of tanstackTableFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source, file).toContain("TableHeaderCell");
      expect(source, file).toContain("<TableHeaderCell {header} />");
    }
  });

  it("keeps route-backed static tables on explicit sorting buttons", () => {
    for (const file of routeBackedStaticTables) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source, file).toContain("SortingButton");
      expect(source, file).toMatch(/toggleSort|toggleInstanceSort/);
    }
  });
});
