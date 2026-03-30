import { describe, expect, it } from "vitest";
import { computeLayoutClosePlan, formatApplyErrorMessage } from "./workbench-helpers";

describe("computeLayoutClosePlan", () => {
  it("returns no tabs to close when removed panes are empty", () => {
    const result = computeLayoutClosePlan(["a", null, null], 2);
    expect(result.occupiedRemovedPaneCount).toBe(0);
    expect(result.tabsToClose).toEqual([]);
  });

  it("closes only tabs that are not retained in visible panes", () => {
    const result = computeLayoutClosePlan(["a", "b", "c"], 2);
    expect(result.occupiedRemovedPaneCount).toBe(1);
    expect(result.tabsToClose).toEqual(["c"]);
  });

  it("does not close duplicate tab if it remains in visible pane", () => {
    const result = computeLayoutClosePlan(["a", "b", "a"], 2);
    expect(result.occupiedRemovedPaneCount).toBe(1);
    expect(result.tabsToClose).toEqual([]);
  });

  it("closes every unique hidden tab when shrinking to a single pane", () => {
    const result = computeLayoutClosePlan(["a", "b", "c"], 1);
    expect(result.occupiedRemovedPaneCount).toBe(2);
    expect(result.tabsToClose).toEqual(["b", "c"]);
  });

  it("keeps retained tab id out of close list even if hidden pane repeats it", () => {
    const result = computeLayoutClosePlan(["a", "b", "a"], 1);
    expect(result.occupiedRemovedPaneCount).toBe(2);
    expect(result.tabsToClose).toEqual(["b"]);
  });
});

describe("formatApplyErrorMessage", () => {
  it("adds immutable pod guidance for forbidden pod spec updates", () => {
    const raw =
      'The Pod "demo" is invalid: spec: Forbidden: pod updates may not change fields other than ...';
    const result = formatApplyErrorMessage(raw, "default/demo");
    expect(result).toContain("Kubernetes blocks direct updates");
    expect(result).toContain(raw);
  });

  it("returns full raw error for non-immutable errors", () => {
    const raw = "something else failed";
    expect(formatApplyErrorMessage(raw, "default/demo")).toBe(raw);
  });
});
