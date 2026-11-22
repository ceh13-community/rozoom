import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");

// "Cached - just now - Ready" in amber showed on 25+ pages that are not lists (Overview,
// Triage, Helm, Compliance...) while the data was fresh.
describe("cluster page cache banner", () => {
  it("shows only when the data on screen is stale", () => {
    const condition = /\{#if workloadCacheBanner[^}]*\}/.exec(source)?.[0] ?? "";
    expect(condition).toContain('workloads.cache.state === "stale"');
    expect(condition).toContain("$listFreshnessOwners === 0");
  });
});
