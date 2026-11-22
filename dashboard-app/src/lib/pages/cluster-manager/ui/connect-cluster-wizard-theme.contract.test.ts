import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Connect Cluster forms (Cloud Provider, OIDC, Vault, certificate, token, exec) drew their
// fields in a fixed dark slate: on the light theme they were dark boxes with light text.
const source = readFileSync(resolve(__dirname, "connect-cluster-wizard.svelte"), "utf8");

describe("connect cluster form fields", () => {
  it("follow the app theme", () => {
    expect(source).not.toContain("bg-slate-900/50");
    expect(source).not.toContain("placeholder:text-slate-600");
    expect(source).not.toMatch(/<h3 class="[^"]*text-slate-200/);
    expect(source).toContain("border border-input bg-background text-foreground");
  });
});
