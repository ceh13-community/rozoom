import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list stream bootstrap contract", () => {
  it("runs the pod watch while the list is open and keeps the snapshot as a fallback", () => {
    expect(source).toContain("untrack(() => initPodsSync(clusterId));");
    expect(source).toContain("destroyPodsSync(clusterId);");
    expect(source).toContain("selectPodsStreamLive(clusterId).subscribe");
    expect(source).toMatch(
      /if \(podsStreamLive\) metricsRefreshToken \+= 1;\s*else await loadPodsSnapshot\(\);/,
    );
    expect(source).toContain("if (!podsStreamLive) setInitialPods(data.slug, items);");
    expect(source).toContain("scheduleRefresh();");
  });
});
