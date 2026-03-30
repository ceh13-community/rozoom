import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");

describe("cluster page transition contract", () => {
  it("defers workspace hydration until after the initial mount tick", () => {
    expect(source).toContain(
      "let workspaceHydrationTimeout: ReturnType<typeof setTimeout> | null = null;",
    );
    expect(source).toContain("workspaceHydrationTimeout = setTimeout(() => {");
    expect(source).toContain("const hydratedPinnedTabs = readPinnedTabs(PINNED_CLUSTER_TABS_KEY);");
    expect(source).toContain("const isHydratedRoutePinned = hydratedPinnedTabs.some(");
    expect(source).toContain("createDefaultWorkspacePanes()");
    expect(source).toContain("readWorkspacePanes(WORKSPACE_PANES_KEY");
    expect(source).toContain("if (!isNamespaceScoped) return;");
    expect(source).toContain("void getClusterNamespaces(cluster);");
    expect(source).toContain("Workspace hydration completed in");
    expect(source).toContain("workspaceHydrated = true;");
    expect(source).toContain("if (workspaceHydrationTimeout) {");
    expect(source).toContain("clearTimeout(workspaceHydrationTimeout);");
  });
});
