import { describe, expect, it } from "vitest";
import { calculateCostEfficiency, DEFAULT_PRICING } from "./cost-efficiency";

describe("cost-efficiency", () => {
  it("calculates cost and wasted resources per namespace", () => {
    const report = calculateCostEfficiency([
      {
        namespace: "prod",
        cpuRequestMillicores: 4000,
        cpuUsageMillicores: 2000,
        memoryRequestMiB: 8192,
        memoryUsageMiB: 4096,
      },
      {
        namespace: "dev",
        cpuRequestMillicores: 2000,
        cpuUsageMillicores: 500,
        memoryRequestMiB: 4096,
        memoryUsageMiB: 1024,
      },
    ]);

    expect(report.entries).toHaveLength(2);
    expect(report.totals.totalMonthly).toBeGreaterThan(0);
    expect(report.totals.wastedMonthly).toBeGreaterThan(0);
    expect(report.totals.efficiencyPercent).toBeGreaterThan(0);
    expect(report.totals.efficiencyPercent).toBeLessThan(100);
  });

  it("sorts by wasted cost descending", () => {
    const report = calculateCostEfficiency([
      {
        namespace: "efficient",
        cpuRequestMillicores: 1000,
        cpuUsageMillicores: 900,
        memoryRequestMiB: 1024,
        memoryUsageMiB: 900,
      },
      {
        namespace: "wasteful",
        cpuRequestMillicores: 4000,
        cpuUsageMillicores: 200,
        memoryRequestMiB: 8192,
        memoryUsageMiB: 512,
      },
    ]);

    expect(report.entries[0]?.namespace).toBe("wasteful");
    expect(report.entries[0]?.wastedTotalMonthly).toBeGreaterThan(
      report.entries[1]!.wastedTotalMonthly,
    );
  });

  it("calculates efficiency percentages", () => {
    const report = calculateCostEfficiency([
      {
        namespace: "half",
        cpuRequestMillicores: 1000,
        cpuUsageMillicores: 500,
        memoryRequestMiB: 1024,
        memoryUsageMiB: 512,
      },
    ]);

    expect(report.entries[0]?.cpuEfficiency).toBe(50);
    expect(report.entries[0]?.memoryEfficiency).toBe(50);
  });

  it("uses default pricing", () => {
    expect(DEFAULT_PRICING.cpuPerCoreMonth).toBe(30);
    expect(DEFAULT_PRICING.memoryPerGiBMonth).toBe(4);
  });

  it("accepts custom pricing", () => {
    const report = calculateCostEfficiency(
      [
        {
          namespace: "test",
          cpuRequestMillicores: 1000,
          cpuUsageMillicores: 500,
          memoryRequestMiB: 1024,
          memoryUsageMiB: 512,
        },
      ],
      { cpuPerCoreMonth: 60, memoryPerGiBMonth: 8 },
    );

    expect(report.entries[0]?.cpuCostMonthly).toBe(60);
  });

  it("handles zero requests", () => {
    const report = calculateCostEfficiency([
      {
        namespace: "no-req",
        cpuRequestMillicores: 0,
        cpuUsageMillicores: 100,
        memoryRequestMiB: 0,
        memoryUsageMiB: 200,
      },
    ]);

    expect(report.entries[0]?.cpuEfficiency).toBe(0);
    expect(report.entries[0]?.totalCostMonthly).toBe(0);
  });

  it("handles empty input", () => {
    const report = calculateCostEfficiency([]);
    expect(report.entries).toHaveLength(0);
    expect(report.totals.efficiencyPercent).toBe(0);
  });
});
