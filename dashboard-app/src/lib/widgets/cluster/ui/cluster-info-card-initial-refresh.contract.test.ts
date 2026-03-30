import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/widgets/cluster/ui/cluster-info-card.svelte"), "utf8");

describe("cluster info card initial refresh contract", () => {
  it("activates summary widgets only after the first forced refresh finishes", () => {
    const updateCall = "await updateClusterHealthChecks(cluster.uuid, { force: true });";
    const hideHint = "cluster.needsInitialRefreshHint = false;";
    const persistHint = "void markClusterRefreshHintSeen(cluster.uuid);";

    expect(source).toContain("const completingInitialRefresh = cluster.needsInitialRefreshHint;");
    expect(source).toContain(updateCall);
    expect(source).toContain("if (completingInitialRefresh) {");
    expect(source).toContain(hideHint);
    expect(source).toContain(persistHint);
    expect(source.indexOf(updateCall)).toBeLessThan(source.indexOf(hideHint));
    expect(source.indexOf(hideHint)).toBeLessThan(source.indexOf(persistHint));
  });
});
