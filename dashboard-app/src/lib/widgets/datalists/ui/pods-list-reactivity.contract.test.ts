import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list props reactivity contract", () => {
  it("keeps data props reactive and rehydrates pods store when pods payload arrives later", () => {
    expect(source).toContain("let { data }: PodsListProps = $props();");
    expect(source).toContain("if (!Array.isArray(data.pods)) return;");
    expect(source).toContain("setInitialPods(data.slug, data.pods);");
  });
});
