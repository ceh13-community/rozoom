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

  it("keeps popover and dropdown content inside the window", () => {
    // A popover taller than the space next to its trigger used to run past the
    // window edge with no way to scroll to the clipped part.
    const popoverContent = read("src/lib/shared/ui/popover/popover-content.svelte");
    const dropdownContent = read("src/lib/shared/ui/dropdown-menu/dropdown-menu-content.svelte");

    expect(popoverContent).toContain("max-h-[var(--bits-popover-content-available-height");
    expect(popoverContent).toContain("overflow-y-auto");
    expect(dropdownContent).toContain("max-h-[var(--bits-dropdown-menu-content-available-height");
    expect(dropdownContent).toContain("overflow-y-auto");
  });
});
