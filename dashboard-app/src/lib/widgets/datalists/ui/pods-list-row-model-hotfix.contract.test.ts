import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list row model contract", () => {
  it("uses a minimal display slice before row adaptation", () => {
    expect(source).toContain("function getPodsDisplaySlice(sourcePods: Partial<PodItem>[]) {");
    expect(source).toContain("const pods = $derived.by(() => getPodsDisplaySlice(sourcePods));");
    expect(source).toContain("const rows = $derived.by(() => createPodListRows(pods));");
  });
});
