import { describe, expect, it } from "vitest";
import { createBatchPlan, updateBatchStep, buildBatchKubectlArgs } from "./batch-operations";

describe("batch-operations", () => {
  const targets = [
    { kind: "Deployment", name: "web", namespace: "prod" },
    { kind: "Deployment", name: "api", namespace: "prod" },
  ];

  it("creates a plan with pending steps", () => {
    const plan = createBatchPlan("restart", targets);
    expect(plan.totalSteps).toBe(2);
    expect(plan.status).toBe("planned");
    expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("updates step progress", () => {
    let plan = createBatchPlan("scale", targets, { scale: { replicas: 3 } });
    plan = updateBatchStep(plan, 0, { status: "success", durationMs: 500 });
    expect(plan.progressPercent).toBe(50);
    plan = updateBatchStep(plan, 1, { status: "success", durationMs: 400 });
    expect(plan.status).toBe("completed");
    expect(plan.progressPercent).toBe(100);
  });

  it("marks plan as failed if any step errors", () => {
    let plan = createBatchPlan("delete", targets);
    plan = updateBatchStep(plan, 0, { status: "success" });
    plan = updateBatchStep(plan, 1, { status: "error", error: "forbidden" });
    expect(plan.status).toBe("failed");
    expect(plan.failedSteps).toBe(1);
  });

  it("builds correct kubectl args", () => {
    expect(buildBatchKubectlArgs("restart", targets[0])).toEqual([
      "rollout",
      "restart",
      "deployment/web",
      "-n",
      "prod",
    ]);
    expect(buildBatchKubectlArgs("scale", targets[0], { scale: { replicas: 5 } })).toContain(
      "--replicas",
    );
    expect(buildBatchKubectlArgs("delete", targets[0])).toContain("delete");
  });
});
