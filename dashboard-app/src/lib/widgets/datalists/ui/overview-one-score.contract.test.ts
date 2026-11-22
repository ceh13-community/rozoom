import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// "Health score 64 / 100 Unhealthy" next to "Cluster score 0 / 100 Unsafe" read as a
// contradiction. One headline score; the posture score opens on request, named for what
// it measures.
const overview = readFileSync(resolve(__dirname, "overview.svelte"), "utf8");
const scoreCard = readFileSync(resolve(__dirname, "../../cluster/ui/cluster-score.svelte"), "utf8");

describe("overview scores", () => {
  it("shows the health score and keeps the posture score behind an expander", () => {
    const health = overview.indexOf("<ClusterHealthScore checks={clusterHealth} />");
    const details = overview.indexOf('data-testid="overview-posture-details"');
    const posture = overview.indexOf("<ClusterScore checks={clusterHealth} />");
    expect(health).toBeGreaterThan(-1);
    expect(details).toBeGreaterThan(health);
    expect(posture).toBeGreaterThan(details);
    expect(overview.slice(details, posture)).toContain("Reliability and security posture");
  });

  it("names the second score for what it measures", () => {
    expect(scoreCard).toContain("Reliability and security");
    expect(scoreCard).not.toMatch(/^\s*Cluster score\s*$/m);
  });
});
