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

  // Dark tints (provider badges) and dark borders (inactive OIDC and exec pills) read as dark
  // patches on the light theme without a dark: pair.
  it("pair dark backgrounds and borders with dark:", () => {
    const dark = [
      ...source.matchAll(
        /(?<![\w:-])(?:bg-[a-z]+-(?:800|900|950)(?:\/\d+)?|border-slate-(?:600|700|800))\b/g,
      ),
    ].map((m) => m[0]);
    expect(dark).toEqual([]);
  });

  // White text on hover and light placeholders vanish on a light background.
  it("pair white hovers and light placeholders with dark:", () => {
    const light = [
      ...source.matchAll(
        /(?<![\w:-])(?:(?:group-)?hover:text-white|placeholder:text-[a-z]+-(?:200|300|400))\b/g,
      ),
    ].map((m) => m[0]);
    expect(light).toEqual([]);
  });

  it("follow the app theme", () => {
    expect(source).not.toContain("bg-slate-900/50");
    // The preview, test and Vault panels were fixed dark boxes too.
    expect(source).not.toMatch(/\bbg-slate-(900|950)\//);
    expect(source).not.toContain("placeholder:text-slate-600");
    expect(source).not.toMatch(/<h3 class="[^"]*text-slate-200/);
    expect(source).toContain("border border-input bg-background text-foreground");
  });
});
