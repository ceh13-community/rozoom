import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/kubectl-proxy", () => ({
  kubectlRawArgsFront: vi.fn(),
}));

import { kubectlRawArgsFront } from "$shared/api/kubectl-proxy";
import {
  createBatchPlan,
  updateBatchStep,
  buildBatchKubectlArgs,
  gateBatchPlan,
} from "./batch-operations";

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

  describe("gateBatchPlan", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("marks denied steps as errors with a plain-language message before running", async () => {
      vi.mocked(kubectlRawArgsFront).mockResolvedValue({ output: "no\n", errors: "", code: 0 });

      const plan = createBatchPlan("delete", targets);
      const result = await gateBatchPlan(plan, "cluster-a");

      expect(result.deniedSteps).toBe(2);
      expect(result.plan.steps.every((s) => s.status === "error")).toBe(true);
      expect(result.plan.steps[0].error).toContain('delete deployment "web"');
      expect(result.plan.steps[0].error).not.toMatch(/Error from server/);
      expect(kubectlRawArgsFront).toHaveBeenCalledTimes(1);
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(
        ["auth", "can-i", "delete", "deployment", "-n", "prod"],
        expect.objectContaining({ clusterId: "cluster-a" }),
      );
    });

    it("checks patch permission for scale and leaves allowed steps pending", async () => {
      vi.mocked(kubectlRawArgsFront).mockResolvedValue({ output: "yes\n", errors: "", code: 0 });

      const plan = createBatchPlan("scale", targets, { scale: { replicas: 3 } });
      const result = await gateBatchPlan(plan, "cluster-a");

      expect(result.deniedSteps).toBe(0);
      expect(result.plan.steps.every((s) => s.status === "pending")).toBe(true);
      expect(kubectlRawArgsFront).toHaveBeenCalledWith(
        ["auth", "can-i", "patch", "deployment", "-n", "prod"],
        expect.objectContaining({ clusterId: "cluster-a" }),
      );
    });

    it("fails open when can-i cannot decide", async () => {
      vi.mocked(kubectlRawArgsFront).mockResolvedValue({
        output: "",
        errors: "no such command",
        code: 1,
      });

      const plan = createBatchPlan("delete", targets);
      const result = await gateBatchPlan(plan, "cluster-a");

      expect(result.deniedSteps).toBe(0);
      expect(result.unknownChecks).toBe(2);
      expect(result.plan.steps.every((s) => s.status === "pending")).toBe(true);
    });

    it("gates namespaces independently", async () => {
      vi.mocked(kubectlRawArgsFront).mockImplementation(async (args: string[]) => ({
        output: args.includes("prod") ? "no\n" : "yes\n",
        errors: "",
        code: 0,
      }));

      const plan = createBatchPlan("delete", [
        { kind: "Deployment", name: "web", namespace: "prod" },
        { kind: "Deployment", name: "web", namespace: "staging" },
      ]);
      const result = await gateBatchPlan(plan, "cluster-a");

      expect(result.deniedSteps).toBe(1);
      expect(result.plan.steps[0].status).toBe("error");
      expect(result.plan.steps[1].status).toBe("pending");
      expect(kubectlRawArgsFront).toHaveBeenCalledTimes(2);
    });
  });
});
