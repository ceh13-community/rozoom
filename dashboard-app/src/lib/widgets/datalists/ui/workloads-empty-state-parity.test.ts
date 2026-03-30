import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("workloads empty-state parity", () => {
  it("does not use destructive no-data alerts for the next workloads pages", () => {
    const files = [
      "src/lib/widgets/datalists/ui/stateful-sets-list.svelte",
      "src/lib/widgets/datalists/ui/replica-sets-list.svelte",
      "src/lib/widgets/datalists/ui/jobs-list.svelte",
      "src/lib/widgets/datalists/ui/cron-jobs-list.svelte",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain("<Alert.Title>No data</Alert.Title>");
      expect(source).not.toContain("No jobs found");
      expect(source).not.toContain("No cron jobs found");
      expect(source).not.toContain("No replica sets found");
      expect(source).not.toContain("No stateful sets found");
    }
  });
});
