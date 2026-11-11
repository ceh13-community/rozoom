import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom does no layout, so this pins the classes that keep the Quick actions buttons inside
// their card. From the lg breakpoint the card is half the window wide; a row switched by a
// viewport breakpoint (sm:flex-row) put three nowrap buttons on one ~450px line and pushed
// "Add all detected" past the card edge, squeezing "N detected · M selected" into a column.
function quickActionsBlock() {
  const source = readFileSync(
    resolve("src/lib/pages/cluster-manager/ui/cluster-manager.svelte"),
    "utf8",
  );
  const start = source.indexOf('data-testid="quick-actions-row"');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("Add all detected", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(source.lastIndexOf("<div", start), end);
}

describe("cluster manager quick actions layout", () => {
  it("wraps to the card width instead of switching rows on a viewport breakpoint", () => {
    const block = quickActionsBlock();
    expect(block).not.toMatch(/\bsm:flex-row\b/);
    const classLists = [...block.matchAll(/class="([^"]*)"/g)].map((match) => match[1]);
    const flexRows = classLists.filter((list) => /\bflex\b/.test(list) && !/flex-col/.test(list));
    expect(flexRows.length).toBeGreaterThanOrEqual(2);
    for (const list of flexRows) expect(list).toMatch(/\bflex-wrap\b/);
  });

  it("keeps the detected and selected count on one line", () => {
    const block = quickActionsBlock();
    expect(block).toMatch(
      /class="[^"]*\bwhitespace-nowrap\b[^"]*"[^>]*>\s*\{detectedClusters\.length\} detected/,
    );
  });
});
