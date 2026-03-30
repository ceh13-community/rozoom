import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/lib/pages/cluster/ui/cluster-page.svelte"), "utf8");

describe("cluster page navigation safety contract", () => {
  it("does not use blocking tauri logger calls on mount", () => {
    expect(source).not.toContain("@tauri-apps/plugin-log");
    expect(source).not.toContain("await debug(");
    expect(source).not.toContain("await error(");
  });

  it("does not block mount on cluster config reload", () => {
    expect(source).not.toContain("await loadClusters();");
    expect(source).toContain("void loadClusters()");
  });
});
