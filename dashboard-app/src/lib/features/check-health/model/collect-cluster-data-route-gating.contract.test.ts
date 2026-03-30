import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/features/check-health/model/collect-cluster-data.ts"),
  "utf8",
);

describe("collect cluster data route gating contract", () => {
  it("keeps heavy observability probes off the global cluster watcher path", () => {
    expect(source).toContain("isDashboardFeatureRouteActive(clusterId, {");
    expect(source).toContain('workloads: ["metricssources"]');
    expect(source).toContain("buildDeferredMetricsChecks(previousCheck)");
    expect(source).toContain("Promise.resolve(buildDeferredBlackboxReport(previousCheck))");
  });
});
