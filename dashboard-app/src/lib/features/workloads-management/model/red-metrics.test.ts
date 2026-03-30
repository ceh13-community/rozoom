import { describe, expect, it } from "vitest";
import { buildRedMetrics, RED_PROMQL } from "./red-metrics";

describe("red-metrics", () => {
  it("calculates rate, error rate, and latency per service", () => {
    const report = buildRedMetrics([
      {
        service: "web",
        namespace: "prod",
        totalRequests: 10000,
        errorRequests: 50,
        p50LatencyMs: 20,
        p95LatencyMs: 150,
        p99LatencyMs: 500,
        windowSeconds: 300,
      },
    ]);

    expect(report.entries).toHaveLength(1);
    const entry = report.entries[0]!;
    expect(entry.rate).toBeCloseTo(33.33, 1);
    expect(entry.errorPercent).toBe(0.5);
    expect(entry.status).toBe("healthy");
  });

  it("grades degraded when error > 1%", () => {
    const report = buildRedMetrics([
      {
        service: "api",
        namespace: "prod",
        totalRequests: 1000,
        errorRequests: 20,
        p50LatencyMs: 50,
        p95LatencyMs: 200,
        p99LatencyMs: 800,
        windowSeconds: 60,
      },
    ]);

    expect(report.entries[0]!.errorPercent).toBe(2);
    expect(report.entries[0]!.status).toBe("degraded");
  });

  it("grades critical when error > 5%", () => {
    const report = buildRedMetrics([
      {
        service: "db",
        namespace: "prod",
        totalRequests: 1000,
        errorRequests: 100,
        p50LatencyMs: 100,
        p95LatencyMs: 2000,
        p99LatencyMs: 5000,
        windowSeconds: 60,
      },
    ]);

    expect(report.entries[0]!.status).toBe("critical");
  });

  it("grades critical when p95 > 5000ms", () => {
    const report = buildRedMetrics([
      {
        service: "slow",
        namespace: "prod",
        totalRequests: 100,
        errorRequests: 0,
        p50LatencyMs: 1000,
        p95LatencyMs: 6000,
        p99LatencyMs: 10000,
        windowSeconds: 60,
      },
    ]);

    expect(report.entries[0]!.status).toBe("critical");
  });

  it("sorts by error percent descending", () => {
    const report = buildRedMetrics([
      {
        service: "healthy",
        namespace: "prod",
        totalRequests: 1000,
        errorRequests: 1,
        p50LatencyMs: 10,
        p95LatencyMs: 50,
        p99LatencyMs: 100,
        windowSeconds: 60,
      },
      {
        service: "broken",
        namespace: "prod",
        totalRequests: 1000,
        errorRequests: 100,
        p50LatencyMs: 10,
        p95LatencyMs: 50,
        p99LatencyMs: 100,
        windowSeconds: 60,
      },
    ]);

    expect(report.entries[0]!.service).toBe("broken");
  });

  it("summarizes fleet health", () => {
    const report = buildRedMetrics([
      {
        service: "a",
        namespace: "prod",
        totalRequests: 1000,
        errorRequests: 0,
        p50LatencyMs: 10,
        p95LatencyMs: 50,
        p99LatencyMs: 100,
        windowSeconds: 60,
      },
      {
        service: "b",
        namespace: "prod",
        totalRequests: 1000,
        errorRequests: 100,
        p50LatencyMs: 100,
        p95LatencyMs: 6000,
        p99LatencyMs: 10000,
        windowSeconds: 60,
      },
    ]);

    expect(report.summary.healthyCount).toBe(1);
    expect(report.summary.criticalCount).toBe(1);
    expect(report.summary.totalRate).toBeGreaterThan(0);
  });

  it("handles zero requests", () => {
    const report = buildRedMetrics([
      {
        service: "idle",
        namespace: "dev",
        totalRequests: 0,
        errorRequests: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        windowSeconds: 60,
      },
    ]);

    expect(report.entries[0]!.rate).toBe(0);
    expect(report.entries[0]!.errorPercent).toBe(0);
    expect(report.entries[0]!.status).toBe("healthy");
  });

  it("provides PromQL query templates", () => {
    expect(RED_PROMQL.rate("pods", "5m")).toContain("apiserver_request_total");
    expect(RED_PROMQL.errorRate("pods", "5m")).toContain('code=~"5.."');
    expect(RED_PROMQL.p95Latency("pods", "5m")).toContain("0.95");
  });
});
