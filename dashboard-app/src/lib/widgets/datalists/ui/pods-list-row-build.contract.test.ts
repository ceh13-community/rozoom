import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list row build contract", () => {
  it("builds rows through the minimal PR1 row model instead of the progressive runtime path", () => {
    expect(source).toContain(
      'import { createPodListRows, filterPodListRows } from "./model/pod-list-row";',
    );
    expect(source).toContain("const rows = $derived.by(() => createPodListRows(pods));");
    expect(source).toContain(
      "const filteredRows = $derived.by(() => filterPodListRows(rows, query));",
    );
    expect(source).not.toContain("schedulePodsRowsBuild");
  });
});
