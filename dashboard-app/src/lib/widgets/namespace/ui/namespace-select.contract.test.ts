import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("namespace select contract", () => {
  it("supports toggling all namespaces on and off with a checkbox", () => {
    const source = readFileSync(
      resolve("src/lib/widgets/namespace/ui/namespace-select.svelte"),
      "utf8",
    );

    expect(source).toContain("All Namespaces");
    expect(source).toContain("toggleAllNamespaces");
    expect(source).toContain("commitSelectionIfNeeded");
    expect(source).toContain("EMPTY_NAMESPACE_SELECTION");
    expect(source).toContain('setSelectedNamespace(clusterId, "all")');
    expect(source).toContain("Namespace: No Namespaces");
  });
});
