import { describe, expect, it } from "vitest";
import { buildMigrationPlan } from "./namespace-migration";

describe("namespace-migration", () => {
  it("creates export-transform-apply steps", () => {
    const plan = buildMigrationPlan(
      [{ kind: "Deployment", name: "web", sourceNamespace: "staging" }],
      "prod",
    );
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].action).toBe("export");
    expect(plan.steps[2].action).toBe("apply");
    expect(plan.targetNamespace).toBe("prod");
  });

  it("warns about secrets and configmaps", () => {
    const plan = buildMigrationPlan(
      [{ kind: "Secret", name: "db-creds", sourceNamespace: "staging" }],
      "prod",
    );
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});
