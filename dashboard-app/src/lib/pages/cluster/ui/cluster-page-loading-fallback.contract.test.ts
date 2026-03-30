import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");

describe("cluster page loading fallback contract", () => {
  it("scopes stale-data fallback to the same workload key", () => {
    expect(source).toContain("let lastWorkloadDataKey = $state<string | null>(null);");
    expect(source).toContain("const currentWorkloadDataKey = $derived(");
    expect(source).toContain("lastWorkloadDataKey = currentWorkloadDataKey;");
    expect(source).toContain("lastWorkloadDataKey === currentWorkloadDataKey");
  });
});
