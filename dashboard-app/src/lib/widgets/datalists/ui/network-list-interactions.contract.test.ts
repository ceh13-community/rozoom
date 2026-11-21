import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/network/network-list.svelte"),
  "utf8",
);
const bulkActionsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/network/network-bulk-actions.svelte"),
  "utf8",
);

describe("network list interactions contract", () => {
  it("adds stable selection and bulk actions without workbench runtime", () => {
    expect(source).toContain("let selectedIds = $state(new Set<string>());");
    expect(source).toContain("toggleAll(");
    expect(source).toContain("selectedRows.length > 0");
    expect(source).toContain("<NetworkBulkActions");
    expect(bulkActionsSource).toContain("Copy kubectl get -o yaml");
    expect(bulkActionsSource).toContain("Copy kubectl describe");
    expect(bulkActionsSource).toContain("Run debug describe");
    expect(bulkActionsSource).toContain("Delete");
  });

  it("opens a scoped details sheet and uses kubectl command helpers", () => {
    expect(source).toContain("buildKubectlDescribeCommand");
    expect(source).toContain("buildKubectlGetYamlCommand");
    expect(source).toContain("onRunDebugDescribe");
    expect(source).toContain("openDebugDescribe(");
    expect(source).toContain("<NetworkDetailsSheet");
    expect(source).toContain("<NetworkWorkbenchPanel");
    expect(source).toContain('kind: "service-port-forward"');
  });
});
