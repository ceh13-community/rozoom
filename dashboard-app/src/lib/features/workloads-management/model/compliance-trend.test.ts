import { describe, expect, it } from "vitest";
import { buildComplianceTrend } from "./compliance-trend";

describe("compliance-trend", () => {
  it("computes pass rate trend", () => {
    const result = buildComplianceTrend([
      { timestamp: "2026-03-19T10:00:00Z", passed: 80, failed: 20 },
      { timestamp: "2026-03-20T10:00:00Z", passed: 85, failed: 15 },
      { timestamp: "2026-03-21T10:00:00Z", passed: 90, failed: 10 },
    ]);
    expect(result.trend).toBe("improving");
    expect(result.currentPassRate).toBe(90);
    expect(result.delta).toBe(5);
  });

  it("detects degrading trend", () => {
    const result = buildComplianceTrend([
      { timestamp: "2026-03-20T10:00:00Z", passed: 90, failed: 10 },
      { timestamp: "2026-03-21T10:00:00Z", passed: 70, failed: 30 },
    ]);
    expect(result.trend).toBe("degrading");
  });

  it("handles empty history", () => {
    const result = buildComplianceTrend([]);
    expect(result.currentPassRate).toBe(0);
    expect(result.trend).toBe("stable");
  });
});
