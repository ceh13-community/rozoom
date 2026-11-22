import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Type scale: 14 px body, 12 px floor. Text at 9 to 11 px was hard to read on a laptop
// screen (789 places). K9s overrides have their own check in theme-contrast.test.ts.
const SRC = resolve(__dirname, "../..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(svelte|css|ts)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

const sources = files(SRC)
  .filter((file) => !file.endsWith("themes/k9s.css"))
  .map((file) => ({ file: file.slice(file.indexOf("src/")), text: readFileSync(file, "utf8") }));

describe("type scale floor", () => {
  it("has no Tailwind text size below 12 px", () => {
    const small = sources.filter(({ text }) => /text-\[(\d|1[01])(\.\d+)?px\]/.test(text));
    expect(small.map(({ file }) => file)).toEqual([]);
  });

  it("has no CSS font size below 12 px", () => {
    const small = sources.filter(({ text }) =>
      [...text.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)].some(
        ([, value, unit]) => (unit === "rem" ? Number(value) * 16 : Number(value)) < 12,
      ),
    );
    expect(small.map(({ file }) => file)).toEqual([]);
  });

  it("sets the body text to 14 px", () => {
    const css = readFileSync(resolve(__dirname, "index.css"), "utf8");
    expect(css).toMatch(/body \{[^}]*font-size: 0\.875rem;/);
  });
});
