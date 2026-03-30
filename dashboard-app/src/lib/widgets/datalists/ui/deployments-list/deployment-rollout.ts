export type DeploymentRolloutAction = "restart" | "pause" | "resume" | "undo";

export type DeploymentRolloutResolution =
  | { kind: "noop"; message: string }
  | { kind: "error"; message: string };

export function normalizeDeploymentRolloutResolution(
  action: DeploymentRolloutAction,
  targetRef: string,
  message: string,
): DeploymentRolloutResolution {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();

  if (action === "resume" && lower.includes("is not paused")) {
    return {
      kind: "noop",
      message: `Deployment ${targetRef} is already resumed.`,
    };
  }

  if (action === "pause" && lower.includes("is already paused")) {
    return {
      kind: "noop",
      message: `Deployment ${targetRef} is already paused.`,
    };
  }

  if (action === "restart" && lower.includes("can't restart paused deployment")) {
    return {
      kind: "error",
      message: `Deployment ${targetRef} is paused. Resume it before running rollout restart.`,
    };
  }

  return {
    kind: "error",
    message: normalized || `Failed to ${action} ${targetRef}.`,
  };
}
