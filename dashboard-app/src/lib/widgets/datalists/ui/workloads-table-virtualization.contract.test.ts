import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "src/lib/widgets/datalists/ui/deployments-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/daemon-sets-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/stateful-sets-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/replica-sets-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/jobs-list/data-table.svelte",
  "src/lib/widgets/datalists/ui/cron-jobs-list/data-table.svelte",
];

describe("workloads table virtualization contract", () => {
  it("uses computeVirtualWindow in non-pods tables", () => {
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toContain(
        'import { computeVirtualWindow } from "$shared/lib/virtual-window";',
      );
      expect(source).toContain('import TableSurface from "$shared/ui/table-surface.svelte";');
      expect(source).toContain("const flatVirtualWindow = $derived.by(() =>");
      expect(source).toContain("const flatVisibleRows = $derived.by(() =>");
      expect(source).toContain("<TableSurface onScroll={handleTableScroll}>");
    }
  });
});
