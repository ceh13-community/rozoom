import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);

describe("configuration worker fallback contract", () => {
  it("keeps inline rows visible until the worker result arrives", () => {
    expect(source).toContain("if (!configurationRowsWorkerResult) return inlineFilteredRows;");
    expect(source).toContain("return computeConfigurationRows(rowsSnapshot, {");
  });

  it("clears stale worker output before scheduling a new request", () => {
    expect(source).toContain("configurationRowsWorkerResult = null;");
  });
});
