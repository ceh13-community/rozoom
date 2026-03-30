import { describe, expect, it } from "vitest";
import { orderPinnedTabs } from "./tab-order";

describe("orderPinnedTabs", () => {
  it("keeps original order while moving pinned tabs to the front", () => {
    const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const result = orderPinnedTabs(tabs, new Set(["c", "a"]));
    expect(result.map((tab) => tab.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("returns same list when nothing is pinned", () => {
    const tabs = [{ id: "a" }, { id: "b" }];
    const result = orderPinnedTabs(tabs, new Set());
    expect(result).toEqual(tabs);
  });
});
