import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every Download and Export button saves through save-export.ts, which tells the user where the
// file went or why it failed. A blob link (a.download) or a direct call of the export helper
// saves silently: on Linux the app gave no path, and a failure gave nothing at all.
const SRC = resolve(__dirname, "../../..");
const ALLOWED = new Set(["lib/shared/lib/text-export.ts", "lib/shared/lib/save-export.ts"]);
const SILENT_SAVE = /createObjectURL\(|\bexportCsvArtifact\(|\bexportTextArtifact\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(svelte|ts)$/.test(name) || /\.test\.ts$/.test(name)) return [];
    return [path];
  });
}

describe("exports save through save-export", () => {
  it("no other file saves a download on its own", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => SILENT_SAVE.test(readFileSync(join(SRC, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});
