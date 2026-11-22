import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Connect Cluster forms (Cloud Provider, OIDC, Vault, certificate, token, exec) drew their
// fields in a fixed dark slate: on the light theme they were dark boxes with light text.
const source = readFileSync(resolve(__dirname, "connect-cluster-wizard.svelte"), "utf8");

describe("connect cluster form fields", () => {
  // Light text shades (200 to 400) are for dark backgrounds: without a dark: pair they are
  // near-invisible on the light theme (the local cluster name, amber and indigo hints).
  it("pair every light text shade with dark:, on hover too", () => {
    const bare = [...source.matchAll(/(?<![\w:-])text-[a-z]+-(200|300|400)\b/g)].map((m) => m[0]);
    const hover = [
      ...source.matchAll(/(?<!dark:)(?<![\w-])(?:group-)?hover:text-[a-z]+-(200|300|400)\b/g),
    ].map((m) => m[0]);
    expect(bare).toEqual([]);
    expect(hover).toEqual([]);
  });

  it("follow the app theme", () => {
    expect(source).not.toContain("bg-slate-900/50");
    // The preview, test and Vault panels were fixed dark boxes too.
    expect(source).not.toMatch(/\bbg-slate-(900|950)\//);
    expect(source).not.toContain("placeholder:text-slate-600");
    expect(source).not.toMatch(/<h3 class="[^"]*text-slate-200/);
    expect(source).toContain("border border-input bg-background text-foreground");
  });

  // White 12px text needs 4.5:1: emerald-600 gives 3.77 and indigo-500 4.47, emerald-700
  // 5.48 and indigo-600 6.29. Checked per line (class lists here are one line), whatever the
  // order of the classes.
  it("white text sits on fills dark enough for it", () => {
    const OK_AT_600 = new Set(["indigo", "blue", "violet", "purple", "slate", "gray", "zinc"]);
    const light = source
      .split("\n")
      .filter((line) => /(?<![\w:-])text-white\b/.test(line))
      .flatMap((line) => [...line.matchAll(/(?<![\w:-])bg-([a-z]+)-(\d+)\b/g)])
      .filter(([, hue, shade]) => Number(shade) < (OK_AT_600.has(hue) ? 600 : 700))
      .map((m) => m[0]);
    expect(light).toEqual([]);
  });
});
