import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list PR3 scope contract", () => {
  it("keeps metrics enrichment behind a dedicated boundary instead of the base row path", () => {
    expect(source).toContain("PodMetricsBoundary");
    expect(source).toContain("podsMetricsByKey");
    expect(source).toContain("podsMetricsError");
    expect(source).not.toContain(
      "const rows = $derived.by(() => createPodListRows(" + "podsMetricsByKey",
    );
  });
});
