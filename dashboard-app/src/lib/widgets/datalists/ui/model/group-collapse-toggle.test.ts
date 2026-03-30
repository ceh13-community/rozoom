import { describe, expect, it } from "vitest";
import {
  areAllGroupsCollapsed,
  getGroupCollapseToggleLabel,
  toggleAllGroupsCollapsed,
} from "./group-collapse-toggle";

describe("group collapse toggle", () => {
  it("detects when all groups are collapsed", () => {
    const collapsed = new Set(["namespace:a", "namespace:b"]);
    expect(areAllGroupsCollapsed(collapsed, ["namespace:a", "namespace:b"])).toBe(true);
    expect(areAllGroupsCollapsed(collapsed, ["namespace:a", "namespace:c"])).toBe(false);
  });

  it("toggles all groups from expanded to collapsed", () => {
    const collapsed = new Set<string>(["namespace:a"]);
    const next = toggleAllGroupsCollapsed(collapsed, ["namespace:a", "namespace:b"]);
    expect(next.has("namespace:a")).toBe(true);
    expect(next.has("namespace:b")).toBe(true);
  });

  it("toggles all groups from collapsed to expanded", () => {
    const collapsed = new Set(["namespace:a", "namespace:b"]);
    const next = toggleAllGroupsCollapsed(collapsed, ["namespace:a", "namespace:b"]);
    expect(next.has("namespace:a")).toBe(false);
    expect(next.has("namespace:b")).toBe(false);
  });

  it("returns matching toggle label", () => {
    expect(getGroupCollapseToggleLabel(new Set(["node:n1"]), ["node:n1"])).toBe("Expand all");
    expect(getGroupCollapseToggleLabel(new Set<string>(), ["node:n1"])).toBe("Collapse all");
  });
});
