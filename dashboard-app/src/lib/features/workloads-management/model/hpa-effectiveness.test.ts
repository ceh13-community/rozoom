import { describe, expect, it } from "vitest";
import { evaluateHpaEffectiveness } from "./hpa-effectiveness";

describe("hpa-effectiveness", () => {
  const hpa = (name: string, ns: string, overrides: Record<string, unknown> = {}) => ({
    metadata: { name, namespace: ns },
    spec: { minReplicas: 2, maxReplicas: 10, metrics: [{ type: "Resource" }], ...overrides },
    status: { currentReplicas: 3, desiredReplicas: 3, conditions: [], ...overrides },
  });

  it("scores effective HPA", () => {
    const result = evaluateHpaEffectiveness([hpa("web", "default")]);
    expect(result.entries[0].grade).toBe("effective");
    expect(result.entries[0].score).toBeGreaterThanOrEqual(80);
  });

  it("detects HPA at max replicas", () => {
    const result = evaluateHpaEffectiveness([
      hpa("web", "default", { currentReplicas: 10, desiredReplicas: 10 }),
    ]);
    expect(result.entries[0].issues).toEqual(
      expect.arrayContaining([expect.stringContaining("max replicas")]),
    );
  });

  it("detects no metrics configured", () => {
    const result = evaluateHpaEffectiveness([hpa("web", "default", { metrics: [] })]);
    expect(result.entries[0].issues).toEqual(
      expect.arrayContaining([expect.stringContaining("No scaling metrics")]),
    );
    expect(result.entries[0].score).toBeLessThan(80);
  });

  it("detects scaling condition failure", () => {
    const result = evaluateHpaEffectiveness([
      hpa("web", "default", {
        conditions: [{ type: "ScalingActive", status: "False", reason: "FailedGetMetrics" }],
      }),
    ]);
    expect(result.entries[0].issues[0]).toContain("ScalingActive=False");
  });

  it("sorts worst first", () => {
    const result = evaluateHpaEffectiveness([
      hpa("good", "default"),
      hpa("bad", "default", { metrics: [], currentReplicas: 0, desiredReplicas: 5 }),
    ]);
    expect(result.entries[0].name).toBe("bad");
  });
});
