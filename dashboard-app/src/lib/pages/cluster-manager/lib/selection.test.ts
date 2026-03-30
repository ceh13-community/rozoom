import { describe, expect, it } from "vitest";
import { buildManagedSelection } from "./selection";

const view = [
  { uuid: "a", name: "alpha", addedAt: new Date() },
  { uuid: "b", name: "beta", addedAt: new Date() },
];

describe("buildManagedSelection", () => {
  it("selects only clusters in the filtered view", () => {
    const selection = buildManagedSelection({ view, allSelected: true, previous: { c: true } });

    expect(selection).toEqual({ __all: true, c: true, a: true, b: true });
  });

  it("clears only clusters in the filtered view", () => {
    const selection = buildManagedSelection({
      view,
      allSelected: false,
      previous: { a: true, b: true, c: true },
    });

    expect(selection).toEqual({ __all: false, a: false, b: false, c: true });
  });
});
