import { describe, expect, it } from "vitest";
import { buildUpgradePlan } from "./upgrade-planner";

describe("upgrade-planner", () => {
  it("marks safe when no blockers", () => {
    const result = buildUpgradePlan({
      currentVersion: "1.29",
      latestVersion: "1.31",
      deprecatedApis: [],
      outdatedCharts: [],
    });
    expect(result.safe).toBe(true);
    expect(result.targetVersion).toBe("1.31");
    expect(result.readinessScore).toBe(100);
  });

  it("blocks upgrade on removed APIs", () => {
    const result = buildUpgradePlan({
      currentVersion: "1.29",
      latestVersion: "1.31",
      deprecatedApis: [{ kind: "Ingress", name: "old-ingress", removedInVersion: "1.30" }],
      outdatedCharts: [],
    });
    expect(result.safe).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.targetVersion).toBeNull();
  });

  it("warns on outdated charts", () => {
    const result = buildUpgradePlan({
      currentVersion: "1.29",
      latestVersion: "1.31",
      deprecatedApis: [],
      outdatedCharts: [{ name: "nginx", currentVersion: "1.0", latestVersion: "2.0" }],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.safe).toBe(true);
  });
});
