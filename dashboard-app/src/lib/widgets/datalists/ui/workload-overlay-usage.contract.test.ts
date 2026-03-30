import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const uiRoot = resolve("src/lib/widgets/datalists/ui");

function collectSvelteFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const result: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      result.push(...collectSvelteFiles(path));
      continue;
    }
    if (path.endsWith(".svelte")) {
      result.push(path);
    }
  }
  return result;
}

describe("workload overlay usage contract", () => {
  it("does not use legacy local checklist dropdown overlay style", () => {
    const files = collectSvelteFiles(uiRoot);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("absolute right-0 z-20");
    }
  });
});
