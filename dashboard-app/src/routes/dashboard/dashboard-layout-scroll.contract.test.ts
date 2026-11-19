import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/routes/dashboard/+layout.svelte"), "utf8");

// The main pane and the cluster menu are the app's own scroll containers; the window never
// scrolls. With one <main> for every page, a touchpad scroll still gliding on a long page
// carried its position into the next, shorter page and left it past the end: Global Triage
// and Service Chains looked empty, and the collapsed menu showed blank space below its icons.
describe("dashboard layout scroll position", () => {
  it("gives every page its own main scroll container", () => {
    const mains = [...source.matchAll(/\{#key routeRemountKey\}\s*<main\b[^>]*>/g)];
    expect(mains).toHaveLength(2);
    expect([...source.matchAll(/<main\b/g)]).toHaveLength(2);
  });

  it("keeps the scroll position of both main panes and of the cluster menu inside the content", () => {
    const mains = [...source.matchAll(/<main\b[^>]*>/g)].map(([tag]) => tag);
    for (const tag of mains) expect(tag).toContain("use:keepScrollInRange");

    expect(source).toMatch(
      /<div class="h-full min-h-0 overflow-y-auto pb-4" use:keepScrollInRange>\s*<Accordion\.Root/,
    );
  });
});
