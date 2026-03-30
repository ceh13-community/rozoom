import { describe, expect, it } from "vitest";
import { evaluateSlo, buildSloReport, type SloDefinition } from "./slo-tracking";

const baseDef: SloDefinition = {
  id: "slo-1",
  name: "API Availability",
  service: "api",
  namespace: "prod",
  target: 0.999,
  windowDays: 30,
  sliType: "availability",
};

describe("slo-tracking", () => {
  describe("evaluateSlo", () => {
    it("calculates healthy SLO with budget remaining", () => {
      const result = evaluateSlo({
        definition: baseDef,
        totalRequests: 1_000_000,
        goodRequests: 999_500,
        windowElapsedHours: 360,
      });

      expect(result.currentSli).toBeCloseTo(0.9995, 3);
      expect(result.errorBudgetTotal).toBeCloseTo(0.001, 4);
      expect(result.errorBudgetConsumedPercent).toBeLessThan(100);
      expect(result.status).toBe("ok");
      expect(result.burnRate).toBeLessThan(1);
    });

    it("detects exhausted error budget", () => {
      const result = evaluateSlo({
        definition: baseDef,
        totalRequests: 100_000,
        goodRequests: 99_000,
        windowElapsedHours: 360,
      });

      // errorRate = 1% > budget 0.1% -> exhausted
      expect(result.status).toBe("exhausted");
      expect(result.errorBudgetConsumedPercent).toBeGreaterThanOrEqual(100);
    });

    it("fires page alert at 14.4x burn rate", () => {
      // For 99.9% SLO: 14.4x burn = 1.44% error rate
      const result = evaluateSlo({
        definition: baseDef,
        totalRequests: 100_000,
        goodRequests: 98_560, // ~1.44% errors
        windowElapsedHours: 1,
      });

      const pageAlert = result.alerts.find((a) => a.severity === "page" && a.window === "1h");
      expect(pageAlert?.firing).toBe(true);
      expect(result.burnRate).toBeGreaterThanOrEqual(14);
    });

    it("fires ticket alert at 1x burn rate", () => {
      // For 99.9% SLO: 1x burn = 0.1% error rate
      const result = evaluateSlo({
        definition: baseDef,
        totalRequests: 100_000,
        goodRequests: 99_850, // 0.15% errors -> 1.5x burn
        windowElapsedHours: 72,
      });

      const ticketAlert = result.alerts.find((a) => a.severity === "ticket");
      expect(ticketAlert?.firing).toBe(true);
      expect(result.burnRate).toBeGreaterThanOrEqual(1);
    });

    it("calculates time to exhaustion", () => {
      const result = evaluateSlo({
        definition: baseDef,
        totalRequests: 1_000_000,
        goodRequests: 999_500,
        windowElapsedHours: 360,
      });

      expect(result.timeToExhaustionHours).toBeGreaterThan(0);
    });

    it("handles 99% SLO target", () => {
      const def99: SloDefinition = { ...baseDef, target: 0.99 };
      const result = evaluateSlo({
        definition: def99,
        totalRequests: 10_000,
        goodRequests: 9_950,
        windowElapsedHours: 168,
      });

      // 0.5% errors with 1% budget = 50% consumed
      expect(result.errorBudgetConsumedPercent).toBe(50);
      expect(result.status).toBe("ok");
    });

    it("handles zero requests gracefully", () => {
      const result = evaluateSlo({
        definition: baseDef,
        totalRequests: 0,
        goodRequests: 0,
        windowElapsedHours: 1,
      });

      expect(result.currentSli).toBe(1);
      expect(result.status).toBe("ok");
    });
  });

  describe("buildSloReport", () => {
    it("builds report with summary counts", () => {
      const report = buildSloReport([
        {
          definition: baseDef,
          totalRequests: 1_000_000,
          goodRequests: 999_900,
          windowElapsedHours: 360,
        },
        {
          definition: { ...baseDef, id: "slo-2", name: "DB Latency" },
          totalRequests: 100_000,
          goodRequests: 98_000,
          windowElapsedHours: 360,
        },
      ]);

      expect(report.slos).toHaveLength(2);
      expect(report.summary.total).toBe(2);
      expect(
        report.summary.ok +
          report.summary.warning +
          report.summary.critical +
          report.summary.exhausted,
      ).toBe(2);
    });
  });
});
