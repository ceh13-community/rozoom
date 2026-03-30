/**
 * Compliance Trend (#26)
 *
 * Aggregates compliance scan history into trend data for charting.
 */

export type ComplianceTrendPoint = {
  timestamp: number;
  passRate: number;
  total: number;
  passed: number;
  failed: number;
  label: string;
};
export type ComplianceTrendResult = {
  points: ComplianceTrendPoint[];
  currentPassRate: number;
  trend: "improving" | "degrading" | "stable";
  delta: number;
};

export function buildComplianceTrend(
  history: Array<{ timestamp: string | number; passed: number; failed: number; warnings?: number }>,
): ComplianceTrendResult {
  const points: ComplianceTrendPoint[] = history
    .map((h) => {
      const ts = typeof h.timestamp === "number" ? h.timestamp : new Date(h.timestamp).getTime();
      const total = h.passed + h.failed + (h.warnings ?? 0);
      return {
        timestamp: ts,
        passRate: total > 0 ? Math.round((h.passed / total) * 100) : 0,
        total,
        passed: h.passed,
        failed: h.failed,
        label: new Date(ts).toLocaleDateString(),
      };
    })
    .filter((p) => p.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  const current = points.length > 0 ? points[points.length - 1].passRate : 0;
  const previous = points.length > 1 ? points[points.length - 2].passRate : current;
  const delta = current - previous;
  const trend: ComplianceTrendResult["trend"] =
    delta > 2 ? "improving" : delta < -2 ? "degrading" : "stable";

  return { points, currentPassRate: current, trend, delta };
}
