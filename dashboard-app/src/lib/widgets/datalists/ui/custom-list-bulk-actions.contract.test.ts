import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), "src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const pages = [
  {
    file: "custom-resources/custom-resources-list.svelte",
    marker: "CustomResourcesBulkActions",
  },
  {
    file: "network/network-list.svelte",
    marker: "NetworkBulkActions",
  },
];

describe("custom list bulk actions contract", () => {
  it("uses shared bulk action wrappers with workload-style selected state", () => {
    for (const page of pages) {
      const source = read(page.file);
      expect(source).toContain(page.marker);
      expect(source).toContain("WorkloadSelectionBar");
      expect(source).toContain("count={selectedRows.length}");
      expect(source).toContain("onShowDetails");
      expect(source).toContain("onDelete");
      expect(source).toContain(">Clear</Button");
    }
  });
});
