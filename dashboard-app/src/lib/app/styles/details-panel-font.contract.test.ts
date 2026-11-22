import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(__dirname, file), "utf8");

// Details panels show values in the interface font; mono only for text people copy as is
// (images, YAML, commands, labels and annotations). The K9s theme sets mono on the whole
// body, so it switches panels back to the interface font.
describe("details panel font", () => {
  it("the K9s theme gives details panels the interface font and keeps mono for verbatim text", () => {
    const css = read("themes/k9s.css");
    expect(css).toMatch(/\.k9s \[data-details-panel\] \{\s*font-family: system-ui, sans-serif;/);
    expect(css).toMatch(/\.k9s \[data-details-panel\] :is\(code, pre, kbd, samp, \.font-mono/);
    expect(read("../../shared/ui/details-sheet-portal.svelte")).toContain("data-details-panel");
  });

  it("labels, annotations and images are mono", () => {
    const keyValue = read("../../widgets/datalists/ui/common/key-value-expand.svelte");
    expect(keyValue.match(/break-all font-mono/g)).toHaveLength(2);
    expect(read("../../widgets/datalists/ui/resource-details-sheet.svelte")).toContain(
      '<div class="break-all font-mono">{image}</div>',
    );
  });
});
