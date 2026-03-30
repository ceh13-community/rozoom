import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods lite list contract", () => {
  it("renders from podsStore and owns snapshot-based pods sync lifecycle", () => {
    expect(source).toContain("podsStore");
    expect(source).toContain("fetchNamespacedSnapshotItems<Partial<PodItem>>");
    expect(source).toContain("setInitialPods(data.slug, items);");
    expect(source).toContain("markPodsSyncSuccess(data.slug);");
    expect(source).toContain("selectClusterPodsSyncStatus(data.slug)");
  });
});
