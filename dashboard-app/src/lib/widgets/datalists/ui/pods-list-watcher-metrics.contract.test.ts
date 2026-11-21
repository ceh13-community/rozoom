import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods watcher sequencing contract", () => {
  it("stores snapshot items before marking sync success and then bumps metrics refresh", () => {
    const setInitialPodsCall = "setInitialPods(data.slug, items);";
    const successMark = "markPodsSyncSuccess(data.slug);";
    const metricsRefreshMark = "metricsRefreshToken += 1;";
    const setInitialPodsIndex = source.indexOf(setInitialPodsCall);
    const successIndex = source.indexOf(successMark);
    const metricsRefreshIndex = source.indexOf(metricsRefreshMark);

    expect(setInitialPodsIndex).toBeGreaterThanOrEqual(0);
    expect(successIndex).toBeGreaterThanOrEqual(0);
    expect(metricsRefreshIndex).toBeGreaterThanOrEqual(0);
    expect(setInitialPodsIndex).toBeLessThan(successIndex);
    expect(successIndex).toBeLessThan(metricsRefreshIndex);
  });

  // With the pod watch live the timer skips the snapshot load, and the snapshot load
  // was the only thing that refreshed `kubectl top`: a new pod kept CPU and Memory at
  // n/a, and every pod kept its first sample. The timer bumps the metrics itself.
  it("refreshes pod metrics on the watcher timer while the pod stream is live", () => {
    const timer = /function scheduleRefresh\(\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? "";
    expect(timer).toContain("setTimeout(");
    expect(timer).toMatch(
      /if \(podsStreamLive\) metricsRefreshToken \+= 1;\s*else await loadPodsSnapshot\(\);/,
    );
  });
});
