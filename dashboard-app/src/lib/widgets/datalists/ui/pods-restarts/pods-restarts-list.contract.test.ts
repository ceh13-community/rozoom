import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const listSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-restarts/pods-restarts-list.svelte"),
  "utf8",
);
const tableSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-restarts/data-table.svelte"),
  "utf8",
);

describe("pods restarts list contract", () => {
  it("keeps manual-refresh behavior and stays free of debug console output", () => {
    expect(listSource).not.toContain("setInterval(");
    expect(listSource).not.toContain("console.log(");
    expect(tableSource).not.toContain("console.log(");
  });
});
