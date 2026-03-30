import { describe, expect, it } from "vitest";
import { detectCpuThrottling, THROTTLING_PROMQL } from "./cpu-throttling";

describe("cpu-throttling", () => {
  it("detects throttled containers", () => {
    const report = detectCpuThrottling([
      {
        namespace: "prod",
        pod: "web-abc",
        container: "web",
        throttledPeriods: 500,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 450,
      },
    ]);

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]!.throttlingPercent).toBe(50);
    expect(report.entries[0]!.status).toBe("critical");
    expect(report.entries[0]!.recommendation).toContain("Increase CPU limit");
  });

  it("grades warning at 5-25%", () => {
    const report = detectCpuThrottling([
      {
        namespace: "prod",
        pod: "api-xyz",
        container: "api",
        throttledPeriods: 100,
        totalPeriods: 1000,
        cpuLimitMillicores: 1000,
        cpuUsageMillicores: 200,
      },
    ]);

    expect(report.entries[0]!.throttlingPercent).toBe(10);
    expect(report.entries[0]!.status).toBe("warning");
  });

  it("grades ok below 5%", () => {
    const report = detectCpuThrottling([
      {
        namespace: "prod",
        pod: "svc-123",
        container: "svc",
        throttledPeriods: 10,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 100,
      },
    ]);

    expect(report.entries[0]!.throttlingPercent).toBe(1);
    expect(report.entries[0]!.status).toBe("ok");
    expect(report.entries[0]!.recommendation).toBe("");
  });

  it("recommends increasing limit when usage is high", () => {
    const report = detectCpuThrottling([
      {
        namespace: "prod",
        pod: "hot-pod",
        container: "app",
        throttledPeriods: 300,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 480,
      },
    ]);

    expect(report.entries[0]!.recommendation).toContain("720m");
  });

  it("sorts by throttling percent descending", () => {
    const report = detectCpuThrottling([
      {
        namespace: "a",
        pod: "low",
        container: "c",
        throttledPeriods: 10,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 100,
      },
      {
        namespace: "a",
        pod: "high",
        container: "c",
        throttledPeriods: 500,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 400,
      },
    ]);

    expect(report.entries[0]!.pod).toBe("high");
  });

  it("summarizes throttling across containers", () => {
    const report = detectCpuThrottling([
      {
        namespace: "a",
        pod: "p1",
        container: "c",
        throttledPeriods: 300,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 400,
      },
      {
        namespace: "a",
        pod: "p2",
        container: "c",
        throttledPeriods: 50,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 100,
      },
      {
        namespace: "a",
        pod: "p3",
        container: "c",
        throttledPeriods: 10,
        totalPeriods: 1000,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 50,
      },
    ]);

    expect(report.summary.totalContainers).toBe(3);
    expect(report.summary.throttledContainers).toBe(2);
    expect(report.summary.criticalCount).toBe(1);
    expect(report.summary.warningCount).toBe(1);
  });

  it("handles zero total periods", () => {
    const report = detectCpuThrottling([
      {
        namespace: "a",
        pod: "p1",
        container: "c",
        throttledPeriods: 0,
        totalPeriods: 0,
        cpuLimitMillicores: 500,
        cpuUsageMillicores: 0,
      },
    ]);

    expect(report.entries[0]!.throttlingPercent).toBe(0);
    expect(report.entries[0]!.status).toBe("ok");
  });

  it("provides PromQL query templates", () => {
    expect(THROTTLING_PROMQL.throttlingPercent("default", "5m")).toContain(
      "container_cpu_cfs_throttled_periods_total",
    );
    expect(THROTTLING_PROMQL.cpuUsage("default", "5m")).toContain(
      "container_cpu_usage_seconds_total",
    );
  });
});
