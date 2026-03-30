import { describe, expect, it } from "vitest";
import { computeVirtualWindow } from "./virtual-window";

describe("virtual-window", () => {
  it("returns full range for small lists", () => {
    const result = computeVirtualWindow({
      totalCount: 10,
      rowHeight: 40,
      viewportHeight: 600,
      scrollTop: 0,
      overscan: 5,
    });

    expect(result).toEqual({
      startIndex: 0,
      endIndex: 10,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("calculates clipped window and paddings for large lists", () => {
    const result = computeVirtualWindow({
      totalCount: 1000,
      rowHeight: 40,
      viewportHeight: 400,
      scrollTop: 4000,
      overscan: 4,
    });

    expect(result.startIndex).toBe(96);
    expect(result.endIndex).toBe(114);
    expect(result.paddingTop).toBe(3840);
    expect(result.paddingBottom).toBe((1000 - 114) * 40);
  });
});
