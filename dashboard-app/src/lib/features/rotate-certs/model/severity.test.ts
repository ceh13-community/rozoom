import { describe, expect, it } from "vitest";
import { daysSeverity } from "./severity";

describe("daysSeverity", () => {
  it("returns unknown for undefined/NaN", () => {
    expect(daysSeverity(undefined).label).toBe("unknown");
    expect(daysSeverity(NaN).label).toBe("unknown");
  });

  it("returns expired for negative days", () => {
    const r = daysSeverity(-3);
    expect(r.label).toBe("expired");
    expect(r.tooltip).toContain("3 day(s) ago");
  });

  it("returns critical for <= 7 days", () => {
    expect(daysSeverity(0).label).toBe("critical");
    expect(daysSeverity(5).label).toBe("critical");
    expect(daysSeverity(7).label).toBe("critical");
  });

  it("returns warning for 8..30 days", () => {
    expect(daysSeverity(8).label).toBe("warning");
    expect(daysSeverity(30).label).toBe("warning");
  });

  it("returns soon for 31..90 days", () => {
    expect(daysSeverity(31).label).toBe("soon");
    expect(daysSeverity(90).label).toBe("soon");
  });

  it("returns ok for > 90 days", () => {
    expect(daysSeverity(91).label).toBe("ok");
    expect(daysSeverity(365).label).toBe("ok");
  });

  it("tooltips are user-friendly", () => {
    expect(daysSeverity(5).tooltip).toContain("rotate immediately");
    expect(daysSeverity(20).tooltip).toContain("this week");
    expect(daysSeverity(60).tooltip).toContain("within the month");
  });

  it("badge classes are defined for every label", () => {
    [undefined, -1, 0, 20, 60, 120].forEach((d) => {
      expect(daysSeverity(d).badge).toMatch(/^bg-/);
    });
  });
});
