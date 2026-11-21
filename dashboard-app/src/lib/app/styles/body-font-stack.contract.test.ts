import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "index.css"), "utf8");

/** The families of the first `body { font-family: ... }` rule in index.css. */
function bodyFontFamilies() {
  const at = css.search(/\n\s*body \{/);
  expect(at).toBeGreaterThan(-1);
  const rule = css.slice(at, css.indexOf("}", at));
  const value = /font-family:\s*([^;]+);/.exec(rule)?.[1] ?? "";
  return value.split(",").map((family) => family.trim());
}

// The app ships no web font. On Linux each named family that is not installed costs a
// font lookup at every new text size, so a long stack of fonts from other systems made
// each Text size step freeze the page (measured: about 0.8 s per step, 0.25 s without
// them, same pixels). A named family belongs here only together with its @font-face.
describe("body font stack", () => {
  it("names only generic families", () => {
    expect(bodyFontFamilies()).toEqual(["system-ui", "sans-serif"]);
  });
});
