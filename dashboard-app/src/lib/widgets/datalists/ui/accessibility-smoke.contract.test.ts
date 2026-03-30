import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const podBulkActionsSource = read("pods-list/pod-bulk-actions.svelte");

describe("accessibility smoke contract", () => {
  it("keeps actionable ARIA labels in major workload/configuration views", () => {
    const files = [
      "deployments-list.svelte",
      "daemon-sets-list.svelte",
      "configuration-list.svelte",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).toContain("aria-label");
      expect(source).toContain("confirmWorkbenchTabClose");
    }
    const podsSource = read("pods-list/pods-list.svelte");
    expect(podBulkActionsSource).toContain("aria-label");
    expect(podsSource).toContain("Pause pod runtime section");
  });
});
