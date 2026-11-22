import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// "Compliance score 0 / 100" in large red with 0 PASS, 0 WARN and 0 FAIL: nothing was
// scanned, but it looked like a failed cluster.
const source = readFileSync(resolve(__dirname, "compliance-hub-panel.svelte"), "utf8");

describe("compliance score without scored checks", () => {
  it("shows No data instead of a score", () => {
    expect(source).toMatch(
      /hasScoredChecks = \$derived\(\s*overallTotals\.pass \+ overallTotals\.warn \+ overallTotals\.fail > 0,?\s*\)/,
    );
    const block = source.slice(source.indexOf("{#if hasScoredChecks}"));
    expect(block.indexOf("{overallScore}")).toBeLessThan(block.indexOf("{:else}"));
    expect(block).toContain("No data: no checks were scored");
  });
});
