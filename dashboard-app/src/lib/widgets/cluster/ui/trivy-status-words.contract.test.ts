import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Trivy page printed the store values as they are: "unavailable", "not_installed".
const source = readFileSync(resolve(__dirname, "trivy-hub-panel.svelte"), "utf8");

describe("Trivy statuses", () => {
  it("are shown as words, never as raw store values", () => {
    expect(source).toContain('not_installed: "Not installed"');
    expect(source).not.toMatch(/>\{(summary|provider|prov)\.status\}</);
    expect(source).toContain("summaryStatusLabel[summary.status]");
    expect(source).toContain("providerStatusLabel[provider.status]");
  });
});
