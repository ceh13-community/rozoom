import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve("src/lib/widgets/datalists/ui/daemon-sets-list.svelte"),
  "utf8",
);

describe("daemon sets details contract", () => {
  it("keeps tolerations expandable with detailed rows", () => {
    expect(source).toContain("showTolerationsDetails");
    expect(source).toContain("getTolerationDetails");
    expect(source).toContain("No tolerations.");
    expect(source).toContain("key=");
    expect(source).toContain("op=");
    expect(source).toContain("effect=");
  });
});
