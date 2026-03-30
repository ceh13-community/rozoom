import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list PR3 ui contract", () => {
  it("keeps the base table slim while routing advanced runtime into a workbench boundary", () => {
    expect(source).toContain("PodBulkActions");
    expect(source).toContain("WorkloadSelectionBar");
    expect(source).toContain("count={selectedPods.length}");
    expect(source).toContain("PodDetailsSheet");
    expect(source).toContain("PodWorkbenchPanel");
    expect(source).toContain("PodMetricsBoundary");
    expect(source).toContain("enrichedTableEnabled");
    expect(source).toContain("trailingItem={{");
    expect(source).toContain('label: "View"');
    expect(source).toContain('value: enrichedTableEnabled ? "Enriched" : "Base"');
    expect(source).not.toContain("Pods rewrite PR3 advanced boundary");
  });

  it("keeps cached-first banner copy wired to snapshot hydration and sync status", () => {
    expect(source).toContain("buildPodsSnapshotScopeKey");
    expect(source).toContain("loadPersistedPodsSnapshot");
    expect(source).toContain("resolveWorkloadCachedAt");
    expect(source).toContain("hydrateCachedPodsAt");
    expect(source).toContain(
      "return `Cached · ${ageLabel} · Refresh failed, showing last snapshot`;",
    );
    expect(source).toContain("return `Cached · ${ageLabel} · Refreshing...`;");
    expect(source).toContain("return `Cached · ${ageLabel} · Ready`;");
  });
});
