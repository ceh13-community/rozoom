import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const WRITER = "src/lib/features/cluster-manager/model/tls-gate.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("insecure-skip-tls-verify in generated kubeconfigs", () => {
  it("is written by tls-gate.ts only, so the gate cannot be bypassed by a new builder", () => {
    const writers = sourceFiles(SRC)
      .filter((path) => /insecure-skip-tls-verify:\s*true/.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path));
    expect(writers).toEqual([WRITER]);
  });
});
