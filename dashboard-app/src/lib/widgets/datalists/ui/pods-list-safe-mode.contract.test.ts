import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list safe mode contract", () => {
  it("caps rendered pods rows behind an emergency safe-mode gate", () => {
    expect(source).toContain("const ENABLE_PODS_SAFE_MODE_HOTFIX = true;");
    expect(source).toContain("const PODS_SAFE_MODE_MAX_ROWS = 400;");
    expect(source).toContain("return sourcePods.slice(0, PODS_SAFE_MODE_MAX_ROWS);");
    expect(source).toContain(
      "Rendering first {PODS_SAFE_MODE_MAX_ROWS} of {sourcePods.length} pods",
    );
  });
});
