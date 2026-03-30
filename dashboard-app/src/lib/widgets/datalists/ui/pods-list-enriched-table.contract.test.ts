import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const podsListSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);
const tableSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/data-table.svelte"),
  "utf8",
);
const runtimeUiSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/model/pod-runtime-ui.ts"),
  "utf8",
);

describe("pods enriched table contract", () => {
  it("keeps enriched table mode opt-in and persisted in watcher settings", () => {
    expect(podsListSource).toContain("enrichedTableEnabled");
    expect(podsListSource).toContain("DEFAULT_WATCHER_SETTINGS.enrichedTableEnabled");
    expect(podsListSource).toContain("parsed.enrichedTableEnabled");
    expect(tableSource).toContain('{enrichedTableEnabled ? "Hide live usage" : "Show live usage"}');
    expect(tableSource).toContain("buildPodMetricsSummary");
    expect(runtimeUiSource).toContain("Live usage columns are hidden.");
  });

  it("renders cpu and memory columns only when enriched table mode is enabled", () => {
    expect(tableSource).toContain('enrichedTableEnabled && isColumnVisible("cpu")');
    expect(tableSource).toContain('enrichedTableEnabled && isColumnVisible("memory")');
    expect(tableSource).toMatch(/SortingButton label="CPU"/);
    expect(tableSource).toMatch(/SortingButton label="Memory"/);
    expect(tableSource).toContain("Loading…");
    expect(tableSource).toContain('{getMetricsForRow(row)?.cpu ?? "n/a"}');
    expect(tableSource).toContain('{getMetricsForRow(row)?.memory ?? "n/a"}');
  });

  it("tracks metrics loading state outside the base table path", () => {
    expect(podsListSource).toContain("let podsMetricsLoading = $state(false);");
    expect(podsListSource).toContain("onMetricsLoadingChange={(loading) => {");
    expect(tableSource).toContain("metricsLoading: boolean;");
    expect(tableSource).toContain("buildPodMetricsSummary");
  });
});
