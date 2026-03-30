import { describe, expect, it } from "vitest";
import { computeSecurityPosture } from "./security-posture-score";

describe("security-posture-score", () => {
  it("returns A grade for excellent posture", () => {
    const result = computeSecurityPosture({
      clusterScore: 95,
      healthScore: 90,
      rbacRiskScore: 0,
      secretRotationScore: 100,
      networkIsolationScore: 90,
      podSecurityScore: 95,
    });
    expect(result.grade).toBe("A");
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.topRisks).toHaveLength(0);
  });

  it("returns F grade for critical posture", () => {
    const result = computeSecurityPosture({
      clusterScore: 0,
      healthScore: 20,
      rbacRiskScore: 800,
      secretRotationScore: 10,
      networkIsolationScore: 0,
      podSecurityScore: 0,
    });
    expect(result.grade).toBe("F");
    expect(result.score).toBeLessThan(40);
    expect(result.topRisks.length).toBeGreaterThan(0);
  });

  it("handles partial input", () => {
    const result = computeSecurityPosture({
      clusterScore: 80,
    });
    expect(result.score).toBe(80);
    expect(result.signals).toHaveLength(1);
  });

  it("handles empty input", () => {
    const result = computeSecurityPosture({});
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
  });

  it("inverts RBAC risk score correctly", () => {
    const lowRisk = computeSecurityPosture({ rbacRiskScore: 0 });
    const highRisk = computeSecurityPosture({ rbacRiskScore: 1000 });
    expect(lowRisk.signals[0].score).toBe(100);
    expect(highRisk.signals[0].score).toBe(0);
  });

  it("identifies top risks", () => {
    const result = computeSecurityPosture({
      clusterScore: 95,
      healthScore: 30,
      rbacRiskScore: 600,
      secretRotationScore: 20,
    });
    expect(result.topRisks.length).toBeGreaterThanOrEqual(2);
  });

  it("applies correct weights", () => {
    // clusterScore weight=25, healthScore weight=20
    const clusterOnly = computeSecurityPosture({ clusterScore: 100 });
    const healthOnly = computeSecurityPosture({ healthScore: 100 });
    // Both should be 100 since they're the only signal
    expect(clusterOnly.score).toBe(100);
    expect(healthOnly.score).toBe(100);
  });
});
