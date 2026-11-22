import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every workload details panel shows its blocks in one order: Explain (where the data comes
// from and how fresh it is), Traffic chain, Properties, Pods, Events. The panels are
// separate files, so the order is checked in each.
const BLOCKS = [
  "<DetailsExplainState",
  "<ResourceTrafficChain",
  'font-bold">Properties</h3>',
  'font-bold">Pods</h3>',
  'font-bold">Events</h3>',
];

describe("workload details block order", () => {
  it.each(["resource-details-sheet.svelte", "deployments-list.svelte", "daemon-sets-list.svelte"])(
    "%s: Explain, Traffic chain, Properties, Pods, Events",
    (file) => {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      const positions = BLOCKS.map((block) => source.lastIndexOf(block));
      for (const [index, position] of positions.entries()) {
        expect(position, BLOCKS[index]).toBeGreaterThan(-1);
      }
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    },
  );

  it("pod-details-sheet.svelte: Explain before Traffic chain", () => {
    const source = readFileSync(resolve(__dirname, "pods-list/pod-details-sheet.svelte"), "utf8");
    expect(source.indexOf("<DetailsExplainState")).toBeGreaterThan(-1);
    expect(source.indexOf("<DetailsExplainState")).toBeLessThan(
      source.indexOf("<ResourceTrafficChain"),
    );
  });
});
