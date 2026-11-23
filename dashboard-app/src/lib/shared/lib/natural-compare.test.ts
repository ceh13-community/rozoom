import { describe, expect, it } from "vitest";
import { compareNatural } from "./natural-compare";

describe("compareNatural", () => {
  it("orders numbers inside names by value, not by digits", () => {
    expect(["pod-10", "pod-2", "pod-1"].sort(compareNatural)).toEqual(["pod-1", "pod-2", "pod-10"]);
  });

  it("ignores case", () => {
    expect(compareNatural("Alpha", "alpha")).toBe(0);
    expect(["b", "A", "c"].sort(compareNatural)).toEqual(["A", "b", "c"]);
  });

  it("matches localeCompare with the same options", () => {
    const names = ["web-11", "Web-2", "api-1", "api-01", "zeta", "Alpha"];
    const expected = [...names].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
    );
    expect([...names].sort(compareNatural)).toEqual(expected);
  });
});
