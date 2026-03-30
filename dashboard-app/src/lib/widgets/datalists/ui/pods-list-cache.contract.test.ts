import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list snapshot contract", () => {
  it("loads pods from namespaced snapshots and stores the result in podsStore", () => {
    expect(source).toContain("fetchNamespacedSnapshotItems<Partial<PodItem>>");
    expect(source).toContain('resource: "pods"');
    expect(source).toContain("setInitialPods(data.slug, items);");
    expect(source).toContain("markPodsSyncSuccess(data.slug);");
  });

  it("persists only lightweight watcher settings in PR1", () => {
    expect(source).toContain(
      'const WATCHER_SETTINGS_PREFIX = "dashboard.pods.rewrite.settings.v1";',
    );
    expect(source).toContain("window.localStorage.setItem(");
    expect(source).not.toContain("persistPodsSnapshot(");
    expect(source).not.toContain("hydratePodsFromSnapshot(");
  });
});
