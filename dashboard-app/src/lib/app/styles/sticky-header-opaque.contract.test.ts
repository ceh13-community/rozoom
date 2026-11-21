import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

/** The `background` of a selector's rule block in a theme file. */
function backgroundOf(css: string, selector: string) {
  const at = css.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  const block = css.slice(at, css.indexOf("}", at));
  return /background:\s*([^;]+);/.exec(block)?.[1] ?? "";
}

// The page scrolls under the sticky cluster header and table rows scroll under sticky
// table headers: with an 80-96% fill the rows showed through. Both are opaque now.
describe("sticky headers are opaque", () => {
  it.each([
    ["themes/light.css", "html:not(.dark):not(.k9s) .cluster-sticky-shell"],
    ["themes/dark.css", ".dark:not(.k9s) .cluster-sticky-shell"],
    ["themes/k9s.css", ".k9s .cluster-sticky-shell"],
  ])("%s paints the cluster header without transparency", (file, selector) => {
    const background = backgroundOf(read(file), selector);
    expect(background).toContain("linear-gradient");
    expect(background).not.toMatch(/\/\s*0?\.\d+\)/);
  });

  it("paints sticky table headers without transparency or blur", () => {
    const css = read("index.css");
    for (const name of ["sticky-table-header", "sticky-table-cell", "sticky-table-group-header"]) {
      const at = css.indexOf(`.${name} {`);
      const rule = css.slice(at, css.indexOf("}", at));
      expect(rule).not.toMatch(/bg-(background|muted)\/\d+/);
      expect(rule).not.toContain("backdrop-blur");
    }
  });

  it("gives the cluster header an opaque base fill", () => {
    const page = read("../../pages/cluster/ui/cluster-page.svelte");
    const shell = /class="cluster-sticky-shell [^"]*"/.exec(page)?.[0] ?? "";
    expect(shell).toContain(" bg-background ");
    expect(shell).not.toMatch(/bg-background\/\d+/);
  });
});
