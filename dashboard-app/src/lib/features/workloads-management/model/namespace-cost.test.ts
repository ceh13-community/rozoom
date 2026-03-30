import { describe, expect, it } from "vitest";
import { estimateNamespaceCosts } from "./namespace-cost";

describe("namespace-cost", () => {
  const pod = (ns: string, cpu: string, mem: string) => ({
    metadata: { namespace: ns },
    spec: { containers: [{ resources: { requests: { cpu, memory: mem } } }] },
  });

  it("estimates cost per namespace", () => {
    const result = estimateNamespaceCosts([
      pod("prod", "500m", "1Gi"),
      pod("prod", "500m", "1Gi"),
      pod("dev", "100m", "256Mi"),
    ]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].namespace).toBe("prod");
    expect(result.entries[0].estimatedMonthlyCost).toBeGreaterThan(0);
    expect(result.totalMonthlyCost).toBeGreaterThan(0);
  });

  it("calculates cost percentages", () => {
    const result = estimateNamespaceCosts([pod("a", "1000m", "1Gi"), pod("b", "1000m", "1Gi")]);
    expect(result.entries[0].costPercent).toBe(50);
  });

  it("handles empty input", () => {
    const result = estimateNamespaceCosts([]);
    expect(result.entries).toHaveLength(0);
    expect(result.totalMonthlyCost).toBe(0);
  });
});
