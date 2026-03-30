import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/dashboard/ui/dashboard-page.svelte"), "utf8");

describe("dashboard data profile contract", () => {
  it("limits auto-refreshing cluster cards by the shared dashboard data profile", () => {
    expect(source).toContain('from "$shared/lib/dashboard-data-profile.svelte"');
    expect(source).toContain("const dashboardCardAutoRefreshLimit = $derived(");
    expect(source).toContain("resolveDashboardCardAutoRefreshLimit($dashboardDataProfile)");
    expect(source).toContain("autoRefreshActive={isAutoRefreshActive(index)}");
  });
});
