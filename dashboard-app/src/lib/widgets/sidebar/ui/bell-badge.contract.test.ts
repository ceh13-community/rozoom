import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The unread badge had "left-4.5", a half step Tailwind 3 does not generate: the class did
// nothing and the badge covered most of the bell (62% of it, any count).
const sidebar = readFileSync(resolve(__dirname, "sidebar.svelte"), "utf8");

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return name.endsWith(".svelte") ? [path] : [];
  });
}

describe("notification bell count", () => {
  it("sits on the bell's corner when collapsed and after the label when open", () => {
    const corner = sidebar.indexOf('data-testid="bell-unread-badge"');
    expect(corner).toBeGreaterThan(-1);
    expect(sidebar.slice(corner, corner + 200)).toContain("absolute -right-3 -top-2");
    expect(sidebar).toContain('data-testid="bell-unread-count"');
  });

  it("uses no spacing half step that Tailwind 3 does not generate", () => {
    // Tailwind 3 has 0.5, 1.5, 2.5 and 3.5; a class like left-4.5 is silently dropped.
    const offenders = svelteFiles(resolve(__dirname, "../../..")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/class(?:Name)?=["{`][^"}`]*/g)].flatMap(
        ([classes]) =>
          [...classes.matchAll(/(?:^|[\s"'`{:])-?[a-z]+(?:-[a-z]+)?-([4-9]|\d{2,})\.5\b/g)].map(
            (match) => `${file.slice(file.indexOf("src/lib"))}: ${match[0].trim()}`,
          ),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
