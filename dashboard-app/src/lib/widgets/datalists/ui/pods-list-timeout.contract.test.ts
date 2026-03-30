import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list refresh contract", () => {
  it("uses a refresh timer and stable snapshot error message in PR1", () => {
    expect(source).toContain("refreshTimer = setTimeout(async () => {");
    expect(source).toContain('errorMessage: "Failed to load pods snapshot."');
    expect(source).toContain(
      'const message = error instanceof Error ? error.message : "Failed to load pods snapshot.";',
    );
  });
});
