import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/pods-list/pods-list.svelte"),
  "utf8",
);

describe("pods list storage bootstrap contract", () => {
  it("keeps persisted snapshot hydration read-only and avoids direct snapshot writes", () => {
    expect(source).not.toContain("persistPodsSnapshot(");
    expect(source).not.toContain("hydratePodsFromSnapshot(");
    expect(source).toContain("loadPersistedPodsSnapshot(");
  });
});
