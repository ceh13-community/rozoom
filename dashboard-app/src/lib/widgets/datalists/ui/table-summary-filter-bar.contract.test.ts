import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const sharedFilterPages = ["network/network-list.svelte", "replication-controllers-list.svelte"];

describe("table summary filter bar contract", () => {
  it("keeps route-scoped table pages on the shared summary filter bar", () => {
    for (const file of sharedFilterPages) {
      const source = read(file);
      expect(source).toContain(
        'import TableSummaryFilterBar from "$shared/ui/table-summary-filter-bar.svelte";',
      );
      expect(source).toContain("<TableSummaryFilterBar");
      expect(source).not.toContain('import { Input } from "$shared/ui/input";');
    }
  });
});
