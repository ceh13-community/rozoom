import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("shared overlay layering contract", () => {
  it("keeps dropdown/popover/select content above workbench panes", () => {
    const dropdownContent = read("src/lib/shared/ui/dropdown-menu/dropdown-menu-content.svelte");
    const dropdownSubContent = read(
      "src/lib/shared/ui/dropdown-menu/dropdown-menu-sub-content.svelte",
    );
    const popoverContent = read("src/lib/shared/ui/popover/popover-content.svelte");
    const selectContent = read("src/lib/shared/ui/select/select-content.svelte");

    expect(dropdownContent).toContain("z-[220]");
    expect(dropdownSubContent).toContain("z-[220]");
    expect(popoverContent).toContain("z-[220]");
    expect(selectContent).toContain("z-[220]");
  });
});
