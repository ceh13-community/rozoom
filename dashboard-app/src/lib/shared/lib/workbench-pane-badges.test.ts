import { describe, expect, it } from "vitest";
import { workbenchPaneBadges } from "./workbench-pane-badges";

describe("workbenchPaneBadges", () => {
  it("numbers each tab by the visible pane that shows it", () => {
    const badges = workbenchPaneBadges(["logs:a", "yaml:b", "events:c"], 3);
    expect([...badges.entries()]).toEqual([
      ["logs:a", 1],
      ["yaml:b", 2],
      ["events:c", 3],
    ]);
  });

  it("ignores panes hidden by a smaller layout and empty panes", () => {
    const badges = workbenchPaneBadges(["logs:a", null, "events:c"], 2);
    expect([...badges.entries()]).toEqual([["logs:a", 1]]);
  });

  it("shows no badges in a one-pane layout", () => {
    expect(workbenchPaneBadges(["logs:a", "yaml:b", null], 1).size).toBe(0);
  });
});
