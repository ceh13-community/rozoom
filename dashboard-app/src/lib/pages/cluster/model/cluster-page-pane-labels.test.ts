import { describe, expect, it } from "vitest";
import { workspaceLayoutBadge } from "./cluster-page-debug";
import { paneIndexLabel } from "./cluster-page-panes";

describe("pane names match the 1 2 3 layout switch", () => {
  it("names panes with numbers, not letters", () => {
    expect(paneIndexLabel("pane-1")).toBe("Pane 1");
    expect(paneIndexLabel("pane-2")).toBe("Pane 2");
    expect(paneIndexLabel("pane-3")).toBe("Pane 3");
  });

  it("spells out the saved layout on a pinned chip", () => {
    expect(workspaceLayoutBadge(undefined)).toBe("1 pane");
    expect(workspaceLayoutBadge(1)).toBe("1 pane");
    expect(workspaceLayoutBadge(2)).toBe("2 panes");
    expect(workspaceLayoutBadge(3)).toBe("3 panes");
  });
});
