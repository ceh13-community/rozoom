import { clusterKey } from "./cluster-key";
import { checkActionSafety, type DestructiveAction } from "./cluster-safety";

/**
 * Last-line read-only enforcement at the kubectl/helm execution boundary.
 *
 * guardedAction (UI layer) gives the user a dialog with the block reason, but
 * it only protects call-sites that remembered to use it. This registry lets
 * the shared API layer (kubectl-proxy, helm) resolve a cluster's safety
 * config by the same clusterId callers already pass for kubeconfig routing,
 * so a mutation that slipped past the UI still cannot reach the cluster.
 *
 * The registry lives in shared/ because FSD forbids shared -> features
 * imports; cluster-manager (features) pushes updates in via
 * registerClusterSafetyInfo on every clustersList change.
 */
export type ClusterSafetyInfo = {
  name: string;
  readOnly?: boolean;
  env?: string;
};

const registry = new Map<string, ClusterSafetyInfo>();

export function registerClusterSafetyInfo(
  clusters: ReadonlyArray<{ uuid: string; name: string; readOnly?: boolean; env?: string }>,
): void {
  registry.clear();
  for (const cluster of clusters) {
    const info: ClusterSafetyInfo = {
      name: cluster.name,
      readOnly: cluster.readOnly,
      env: cluster.env,
    };
    // Call-sites pass either the uuid or the cluster name (route slug) as
    // clusterId; kubeconfig files are keyed the same way via clusterKey.
    registry.set(clusterKey(cluster.uuid), info);
    registry.set(clusterKey(cluster.name), info);
  }
}

export function getClusterSafetyInfo(clusterId?: string | null): ClusterSafetyInfo | undefined {
  if (!clusterId) return undefined;
  return registry.get(clusterKey(clusterId));
}

const ROLLOUT_ACTION_BY_SUBCOMMAND: Record<string, DestructiveAction> = {
  restart: "restart-workload",
  pause: "restart-workload",
  resume: "restart-workload",
  undo: "rollback-workload",
};

const ACTION_BY_VERB: Record<string, DestructiveAction> = {
  evict: "delete-pod",
  scale: "scale-workload",
  autoscale: "scale-workload",
  apply: "apply-yaml",
  create: "apply-yaml",
  replace: "apply-yaml",
  run: "apply-yaml",
  expose: "apply-yaml",
  patch: "edit-resource",
  edit: "edit-resource",
  set: "edit-resource",
  label: "edit-resource",
  annotate: "edit-resource",
  taint: "edit-resource",
  cordon: "edit-resource",
  uncordon: "edit-resource",
  drain: "edit-resource",
  exec: "exec-shell",
  attach: "exec-shell",
  debug: "exec-shell",
  cp: "exec-shell",
};

/**
 * Map a kubectl invocation (verb-first args, as all app call-sites build
 * them) to the DestructiveAction it performs, or null for reads.
 */
export function classifyKubectlAction(args: readonly string[]): DestructiveAction | null {
  const verb = args[0]?.trim().toLowerCase();
  if (!verb) return null;
  if (verb === "delete") {
    const target = args[1]?.trim().toLowerCase() ?? "";
    const isPod = target === "pod" || target === "pods" || target.startsWith("pod/");
    return isPod ? "delete-pod" : "delete-resource";
  }
  if (verb === "rollout") {
    const subcommand = args[1]?.trim().toLowerCase();
    return subcommand ? (ROLLOUT_ACTION_BY_SUBCOMMAND[subcommand] ?? null) : null;
  }
  return ACTION_BY_VERB[verb] ?? null;
}

export type ReadOnlyGuardResult = {
  blocked: boolean;
  reason?: string;
};

/**
 * Hard block for the execution boundary: deny mutations on read-only
 * clusters. Confirmation flows (prod clusters, helm-install on read-only)
 * stay in the UI via guardedAction; the boundary only enforces outright
 * denials so it never has to render a dialog.
 */
export function checkKubectlReadOnly(
  clusterId: string | undefined | null,
  args: readonly string[],
): ReadOnlyGuardResult {
  const cluster = getClusterSafetyInfo(clusterId);
  if (!cluster) return { blocked: false };
  const action = classifyKubectlAction(args);
  if (!action) return { blocked: false };
  const check = checkActionSafety(cluster, action);
  if (check.allowed) return { blocked: false };
  return { blocked: true, reason: check.reason };
}

export function checkHelmActionReadOnly(
  clusterId: string | undefined | null,
  action: Extract<DestructiveAction, "helm-install" | "helm-uninstall" | "helm-rollback">,
): ReadOnlyGuardResult {
  const cluster = getClusterSafetyInfo(clusterId);
  if (!cluster) return { blocked: false };
  const check = checkActionSafety(cluster, action);
  if (check.allowed) return { blocked: false };
  return { blocked: true, reason: check.reason };
}

export function buildReadOnlyBlockedResult(reason?: string): {
  output: string;
  errors: string;
  code: number;
} {
  const message = reason ?? "This cluster is read-only. Mutating commands are blocked.";
  return {
    output: "",
    errors: `[BLOCKED] [${new Date().toISOString()}]: ${message}`,
    code: 1,
  };
}

/** Test-only: reset module state between test cases. */
export function resetClusterSafetyRegistryForTests(): void {
  registry.clear();
}
