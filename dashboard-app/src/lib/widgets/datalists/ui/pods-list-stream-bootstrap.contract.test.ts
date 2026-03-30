import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list stream bootstrap contract", () => {
  it("does not wire stream sync into the PR1 table runtime", () => {
    expect(source).not.toContain("initPodsSync(");
    expect(source).not.toContain('podsSyncPolicy.mode === "stream"');
    expect(source).toContain("scheduleRefresh();");
  });
});
