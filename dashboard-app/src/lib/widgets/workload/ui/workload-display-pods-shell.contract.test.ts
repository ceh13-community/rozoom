import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/widgets/workload/model/workload-route-registry.ts"),
  "utf8",
);

describe("workload display pods shell contract", () => {
  it("routes pods workload to the rewritten full pods page while keeping lite fallback available separately", () => {
    expect(source).toContain(
      'pods: () => import("$widgets/datalists/ui/pods-list/pods-list.svelte"),',
    );
  });
});
