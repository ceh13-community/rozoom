import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(resolve("src/lib/widgets/datalists/ui", relativePath), "utf8");
}

const files = [
  "stateful-sets-list.svelte",
  "replica-sets-list.svelte",
  "jobs-list.svelte",
  "cron-jobs-list.svelte",
];

describe("workload notifications parity", () => {
  it("keeps error/success notification visuals aligned with deployments style", () => {
    for (const file of files) {
      const source = read(file);
      expect(source).toContain('<Alert.Root variant="destructive" class="mb-4">');
      expect(source).toContain(
        '<Alert.Root class="mb-4 border-emerald-400/40 bg-emerald-100/20 text-emerald-900 dark:text-emerald-200">',
      );
      expect(source).toContain('aria-label="Close notification"');
      expect(source).toContain(
        'class="absolute right-2 top-2 rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30"',
      );
    }
  });
});
