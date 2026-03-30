import type { AppClusterConfig } from "$entities/config";

export type DestructiveAction =
  | "delete-pod"
  | "delete-resource"
  | "scale-workload"
  | "restart-workload"
  | "rollback-workload"
  | "apply-yaml"
  | "helm-install"
  | "helm-uninstall"
  | "helm-rollback"
  | "exec-shell"
  | "edit-resource";

const ALWAYS_BLOCKED_IN_READONLY: ReadonlySet<DestructiveAction> = new Set([
  "delete-pod",
  "delete-resource",
  "scale-workload",
  "restart-workload",
  "rollback-workload",
  "apply-yaml",
  "helm-uninstall",
  "helm-rollback",
]);

const REQUIRES_CONFIRMATION: ReadonlySet<DestructiveAction> = new Set([
  "helm-install",
  "exec-shell",
  "edit-resource",
]);

export type SafetyCheckResult = {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
};

export function checkActionSafety(
  cluster: Pick<AppClusterConfig, "readOnly" | "env" | "name">,
  action: DestructiveAction,
): SafetyCheckResult {
  if (cluster.readOnly && ALWAYS_BLOCKED_IN_READONLY.has(action)) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: `Cluster "${cluster.name}" is read-only. This action is not permitted.`,
    };
  }

  if (cluster.readOnly && REQUIRES_CONFIRMATION.has(action)) {
    return {
      allowed: true,
      requiresConfirmation: true,
      reason: `Cluster "${cluster.name}" is read-only. Are you sure you want to proceed?`,
    };
  }

  const isProd = isProdEnvironment(cluster.env);
  if (isProd && ALWAYS_BLOCKED_IN_READONLY.has(action)) {
    return {
      allowed: true,
      requiresConfirmation: true,
      reason: `This is a production cluster. Please confirm this destructive action.`,
    };
  }

  return { allowed: true, requiresConfirmation: false };
}

export function isProdEnvironment(env?: string): boolean {
  if (!env) return false;
  const normalized = env.toLowerCase();
  return normalized === "prod" || normalized === "production";
}

export function inferRiskLevel(
  cluster: Pick<AppClusterConfig, "readOnly" | "env">,
): "safe" | "caution" | "locked" {
  if (cluster.readOnly) return "locked";
  if (isProdEnvironment(cluster.env)) return "caution";
  return "safe";
}
