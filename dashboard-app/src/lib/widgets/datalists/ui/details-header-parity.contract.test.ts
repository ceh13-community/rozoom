import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const deploymentsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/deployments-list.svelte"),
  "utf8",
);
const sharedDetailsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/resource-details-sheet.svelte"),
  "utf8",
);
const headerActionsSource = readFileSync(
  resolve("src/lib/widgets/datalists/ui/common/details-header-actions.svelte"),
  "utf8",
);

describe("details header parity contract", () => {
  it("keeps standard icon action button styles aligned with deployments details", () => {
    const actionButtonClass =
      "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground";
    expect(deploymentsSource).toContain("DetailsHeaderActions");
    expect(deploymentsSource).toContain("<DetailsHeaderActions");
    expect(headerActionsSource).toContain(actionButtonClass);
    expect(sharedDetailsSource).toContain("DetailsHeaderActions");
    expect(sharedDetailsSource).toContain("closeAriaLabel");
    expect(sharedDetailsSource).toContain("onClose={closeDetails}");
  });

  it("keeps destructive and close button styles aligned with deployments details", () => {
    const destructiveClass = "rounded p-1.5 text-destructive hover:bg-destructive/10";
    const closeClass =
      "rounded bg-rose-100/70 p-1.5 text-xs text-rose-700 transition hover:bg-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:hover:bg-rose-500/30";

    expect(headerActionsSource).toContain(destructiveClass);
    expect(headerActionsSource).toContain(closeClass);
    expect(sharedDetailsSource).toContain("DetailsHeaderActions");
    expect(sharedDetailsSource).toContain("onDelete");
    expect(sharedDetailsSource).toContain("closeAriaLabel");
  });
});
