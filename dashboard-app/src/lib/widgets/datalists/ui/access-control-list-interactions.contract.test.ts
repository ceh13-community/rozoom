import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/configuration-list.svelte"),
  "utf8",
);
const bulkActionsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/access-control/access-control-bulk-actions.svelte"),
  "utf8",
);

describe("access control list interactions contract", () => {
  it("adds stable selection and bulk actions without workbench runtime", () => {
    expect(source).toContain("let selectedRowIds = $state(new Set<string>());");
    expect(source).toContain("toggleAllRows(");
    expect(source).toContain("selectedRows.length > 0");
    expect(source).toContain("<ConfigurationBulkActions");
    expect(bulkActionsSource).toContain("Copy kubectl get -o yaml");
    expect(bulkActionsSource).toContain("Copy kubectl describe");
    expect(bulkActionsSource).toContain("Run debug describe");
    expect(bulkActionsSource).toContain("Delete");
  });

  it("opens a scoped details sheet and uses kubectl command helpers", () => {
    expect(source).toContain("buildKubectlDescribeCliCommand");
    expect(source).toContain("buildKubectlGetYamlCliCommand");
    expect(source).toContain("onRunDebugDescribe");
    expect(source).toContain("openDebugDescribeForRow(");
    expect(source).toContain('kind: "yaml"');
  });
});
