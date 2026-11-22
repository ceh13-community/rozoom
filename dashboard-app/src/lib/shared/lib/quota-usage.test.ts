import { describe, expect, it } from "vitest";
import { formatQuotaUsageItem, parseQuantity, quotaUsage } from "./quota-usage";

describe("parseQuantity", () => {
  it("reads CPU, memory and plain counts", () => {
    expect(parseQuantity("225m")).toBeCloseTo(0.225);
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("288Mi")).toBe(288 * 2 ** 20);
    expect(parseQuantity("2Gi")).toBe(2 * 2 ** 30);
    expect(parseQuantity("1G")).toBe(1e9);
    expect(parseQuantity("1e3")).toBe(1000);
    expect(parseQuantity("abc")).toBeNull();
  });
});

// The Resource Quotas list had Name, Namespace and Age: not what is used of the limits.
describe("quotaUsage", () => {
  const quota = {
    status: {
      hard: { pods: "20", "requests.cpu": "2", "requests.memory": "2Gi", "count/jobs": "10" },
      used: { pods: "5", "requests.cpu": "225m", "requests.memory": "288Mi" },
    },
  };

  it("lists CPU, memory and pods first, with used against hard", () => {
    const usage = quotaUsage(quota);
    expect(usage.map((item) => item.resource)).toEqual([
      "requests.cpu",
      "requests.memory",
      "pods",
      "count/jobs",
    ]);
    expect(usage.map(formatQuotaUsageItem)).toEqual([
      "CPU requests 225m / 2 (11%)",
      "Memory requests 288Mi / 2Gi (14%)",
      "Pods 5 / 20 (25%)",
      "count/jobs 0 / 10 (0%)",
    ]);
  });

  it("falls back to spec.hard before the quota controller fills the status", () => {
    const usage = quotaUsage({ spec: { hard: { pods: "4" } } });
    expect(usage).toEqual([{ resource: "pods", label: "Pods", used: "0", hard: "4", ratio: 0 }]);
  });
});
