import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list rows worker contract", () => {
  it("keeps worker-based row building out of the PR1 skeleton", () => {
    expect(source).not.toContain("rowsWorker");
    expect(source).not.toContain("new Worker(");
  });
});
