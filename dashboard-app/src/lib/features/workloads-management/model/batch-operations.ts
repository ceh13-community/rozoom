/**
 * Batch Operations Wizard (#4)
 *
 * Plan and track batch kubectl operations (scale, restart, delete)
 * across multiple resources with progress tracking.
 */

import { runCanI, type CanIStatus } from "$shared/api/can-i";
import { humanizeForbiddenAction } from "$shared/lib/forbidden-error";

export type BatchOperationKind = "scale" | "restart" | "delete" | "label" | "annotate";

export type BatchTarget = {
  kind: string;
  name: string;
  namespace: string;
};

export type BatchOperationStep = {
  target: BatchTarget;
  status: "pending" | "running" | "success" | "error";
  error?: string;
  durationMs?: number;
};

export type BatchOperationPlan = {
  kind: BatchOperationKind;
  targets: BatchTarget[];
  steps: BatchOperationStep[];
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  progressPercent: number;
  status: "planned" | "running" | "completed" | "failed";
  estimatedDurationMs: number;
};

export type BatchOperationParams = {
  scale?: { replicas: number };
  label?: Record<string, string>;
  annotation?: Record<string, string>;
};

export function createBatchPlan(
  kind: BatchOperationKind,
  targets: BatchTarget[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for API compatibility
  params?: BatchOperationParams,
): BatchOperationPlan {
  const steps: BatchOperationStep[] = targets.map((target) => ({
    target,
    status: "pending",
  }));

  return {
    kind,
    targets,
    steps,
    totalSteps: steps.length,
    completedSteps: 0,
    failedSteps: 0,
    progressPercent: 0,
    status: "planned",
    estimatedDurationMs: steps.length * 2000,
  };
}

export function updateBatchStep(
  plan: BatchOperationPlan,
  index: number,
  update: { status: BatchOperationStep["status"]; error?: string; durationMs?: number },
): BatchOperationPlan {
  const steps = [...plan.steps];
  steps[index] = { ...steps[index], ...update };

  const completed = steps.filter((s) => s.status === "success").length;
  const failed = steps.filter((s) => s.status === "error").length;
  const done = completed + failed;
  const allDone = done === steps.length;

  return {
    ...plan,
    steps,
    completedSteps: completed,
    failedSteps: failed,
    progressPercent: Math.round((done / steps.length) * 100),
    status: allDone ? (failed > 0 ? "failed" : "completed") : "running",
  };
}

const KIND_TO_VERB: Record<BatchOperationKind, string> = {
  delete: "delete",
  scale: "patch",
  restart: "patch",
  label: "patch",
  annotate: "patch",
};

export type BatchGateResult = {
  plan: BatchOperationPlan;
  deniedSteps: number;
  /** can-i verdicts that could not be determined; those steps stay runnable (fail open). */
  unknownChecks: number;
};

/**
 * Preflights RBAC for every step via `kubectl auth can-i` before anything runs.
 * Denied steps are marked as errors with a plain-language message instead of
 * failing mid-batch with a raw 403 from the API server.
 */
export async function gateBatchPlan(
  plan: BatchOperationPlan,
  clusterId: string,
): Promise<BatchGateResult> {
  const verb = KIND_TO_VERB[plan.kind];
  const uniqueScopes = new Map<string, { resource: string; namespace: string }>();
  for (const step of plan.steps) {
    const resource = step.target.kind.toLowerCase();
    uniqueScopes.set(`${resource}|${step.target.namespace}`, {
      resource,
      namespace: step.target.namespace,
    });
  }

  const verdicts = new Map<string, CanIStatus>();
  await Promise.all(
    [...uniqueScopes.entries()].map(async ([key, scope]) => {
      verdicts.set(key, await runCanI(clusterId, [verb, scope.resource, "-n", scope.namespace]));
    }),
  );

  let gated = plan;
  let deniedSteps = 0;
  let unknownChecks = 0;
  plan.steps.forEach((step, index) => {
    const resource = step.target.kind.toLowerCase();
    const verdict = verdicts.get(`${resource}|${step.target.namespace}`);
    if (verdict === "unknown") unknownChecks += 1;
    if (verdict !== "denied") return;
    deniedSteps += 1;
    gated = updateBatchStep(gated, index, {
      status: "error",
      error: humanizeForbiddenAction({
        verb: plan.kind === "delete" ? "delete" : plan.kind,
        resource,
        name: step.target.name,
        namespace: step.target.namespace,
      }),
    });
  });

  return { plan: gated, deniedSteps, unknownChecks };
}

export function buildBatchKubectlArgs(
  kind: BatchOperationKind,
  target: BatchTarget,
  params?: BatchOperationParams,
): string[] {
  switch (kind) {
    case "restart":
      return [
        "rollout",
        "restart",
        `${target.kind.toLowerCase()}/${target.name}`,
        "-n",
        target.namespace,
      ];
    case "scale":
      return [
        "scale",
        `${target.kind.toLowerCase()}/${target.name}`,
        "--replicas",
        String(params?.scale?.replicas ?? 1),
        "-n",
        target.namespace,
      ];
    case "delete":
      return ["delete", target.kind.toLowerCase(), target.name, "-n", target.namespace];
    case "label":
      return [
        "label",
        target.kind.toLowerCase(),
        target.name,
        "-n",
        target.namespace,
        ...Object.entries(params?.label ?? {}).map(([k, v]) => `${k}=${v}`),
      ];
    case "annotate":
      return [
        "annotate",
        target.kind.toLowerCase(),
        target.name,
        "-n",
        target.namespace,
        ...Object.entries(params?.annotation ?? {}).map(([k, v]) => `${k}=${v}`),
      ];
  }
}
