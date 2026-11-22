import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A bottom sheet spans the window (inset-x-0); with a max width and no auto margins it sat
// in the bottom-left corner on a wide window (Scale, Delete, port-forward, text prompts).
function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return svelteFiles(path);
    return name.endsWith(".svelte") ? [path] : [];
  });
}

describe("bottom sheets with a max width", () => {
  it("are centred with auto margins", () => {
    const offCentre = svelteFiles(resolve(__dirname, "../..")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/side="bottom"[^>]*class="([^"]*)"/g)]
        .filter(([, classes]) => /max-w-/.test(classes) && !/mx-auto/.test(classes))
        .map(() => file.slice(file.indexOf("src/lib"))),
    );
    expect(offCentre).toEqual([]);
  });
});
