import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");
const panesSource = readFileSync(
  resolve("src/lib/pages/cluster/model/cluster-page-panes.ts"),
  "utf8",
);

describe("cluster page pane status contract", () => {
  it("keeps pane status/error rendering gated by effective data", () => {
    expect(source).toContain("function paneHasEffectiveData(paneId: WorkspacePaneId): boolean");
    expect(source).toContain("return derivePaneStatusLabel({");
    expect(panesSource).toContain('if (params.paneLoading && !params.hasData) return "loading";');
    expect(panesSource).toContain('if (params.paneError && !params.hasData) return "error";');
    expect(source).toContain('{#if paneLoading("pane-2") && !paneHasData}');
    expect(source).toContain('{:else if paneError("pane-2") && !paneHasData}');
    expect(source).toContain('{#if paneLoading("pane-3") && !paneHasData}');
    expect(source).toContain('{:else if paneError("pane-3") && !paneHasData}');
  });
});
