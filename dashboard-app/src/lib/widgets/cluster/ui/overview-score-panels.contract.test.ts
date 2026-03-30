import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("overview score panels contract", () => {
  it("keeps detailed and readable sections in both score panels", () => {
    const healthSource = readFileSync(
      resolve("src/lib/widgets/cluster/ui/cluster-health-score.svelte"),
      "utf8",
    );
    const clusterSource = readFileSync(
      resolve("src/lib/widgets/cluster/ui/cluster-score.svelte"),
      "utf8",
    );

    expect(healthSource).toContain("Top degradations");
    expect(healthSource).toContain("No active degradations detected yet");
    expect(healthSource).toContain("Indicator explanations");
    expect(healthSource).toContain("Platform fit review");
    expect(clusterSource).toContain("Top risks");
    expect(clusterSource).toContain("Indicator explanations");
    expect(clusterSource).toContain("Platform fit review");
  });
});
