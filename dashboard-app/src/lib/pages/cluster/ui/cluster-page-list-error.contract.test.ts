import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");

describe("cluster page list error contract", () => {
  it("shows the namespaces error or the list's own load error, as text", () => {
    // namespacesError is a store: the store object is always truthy, so the list's own
    // error (Forbidden included) never showed and an empty list looked like no objects.
    expect(source).toContain("const errorMessage = $derived($namespacesError || workloads.error);");
    expect(source).toContain("{:else if errorMessage && !hasEffectiveWorkloadData}");
    expect(source).toContain("<Alert.Description>{errorMessage}</Alert.Description>");
    expect(source).not.toContain("$errorMessage");
  });
});
