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
  // `certificate approve` issues a certificate, `deny` rejects it: both write.
  certificate: "edit-resource",
};

// Global kubectl flags that consume the next token when written without `=`.
// Needed to find the verb in terminal input such as `kubectl -n prod delete pod x`.
const KUBECTL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-n",
  "--namespace",
  "--context",
  "--cluster",
  "--user",
  "--kubeconfig",
  "-s",
  "--server",
  "--token",
  "--as",
  "--as-group",
  "--as-uid",
  "--request-timeout",
  "--cache-dir",
  "--certificate-authority",
  "--client-certificate",
  "--client-key",
  "--tls-server-name",
  "--profile",
  "--profile-output",
  "-v",
  "--v",
  "--vmodule",
  "--log-flush-frequency",
  "--kube-context",
  "--kube-apiserver",
  "--kube-token",
  "--kube-as-user",
  "--kube-as-group",
  "--kube-ca-file",
  "--kube-tls-server-name",
  "--registry-config",
  "--repository-cache",
  "--repository-config",
]);

/** Positional tokens with leading global flags (and their values) removed. */
function positionalArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i]?.trim() ?? "";
    if (token === "--") {
      out.push(...args.slice(i + 1).map((a) => a.trim()));
      break;
    }
    if (token.startsWith("-")) {
      if (!token.includes("=") && KUBECTL_VALUE_FLAGS.has(token)) i++;
      continue;
    }
    out.push(token);
  }
  return out;
}

/**
 * Map a kubectl invocation to the DestructiveAction it performs, or null for reads.
 * App call-sites build verb-first args; terminal input may put global flags first,
 * so the verb is the first positional token.
 */
export function classifyKubectlAction(args: readonly string[]): DestructiveAction | null {
  const positional = positionalArgs(args);
  const verb = positional[0]?.toLowerCase();
  if (!verb) return null;
  if (verb === "delete") {
    const target = positional[1]?.toLowerCase() ?? "";
    const isPod = target === "pod" || target === "pods" || target.startsWith("pod/");
    return isPod ? "delete-pod" : "delete-resource";
  }
  if (verb === "rollout") {
    const subcommand = positional[1]?.toLowerCase();
    return subcommand ? (ROLLOUT_ACTION_BY_SUBCOMMAND[subcommand] ?? null) : null;
  }
  if (verb === "auth") {
    return positional[1]?.toLowerCase() === "reconcile" ? "apply-yaml" : null;
  }
  // oc only: `oc adm <subcommand>` carries the cluster-admin mutations.
  if (verb === "adm") {
    const subcommand = positional[1]?.toLowerCase() ?? "";
    return OC_ADM_MUTATIONS.has(subcommand) ? "edit-resource" : null;
  }
  return ACTION_BY_VERB[verb] ?? null;
}

const OC_ADM_MUTATIONS: ReadonlySet<string> = new Set([
  "certificate",
  "cordon",
  "uncordon",
  "drain",
  "taint",
  "policy",
  "groups",
  "new-project",
  "prune",
  "migrate",
  "upgrade",
  "pod-network",
  "ipfailover",
  "router",
  "registry",
  "create-bootstrap-project-template",
  "create-error-template",
  "create-login-template",
  "create-provider-selection-template",
]);

const HELM_ACTION_BY_SUBCOMMAND: Record<string, DestructiveAction> = {
  install: "helm-install",
  upgrade: "helm-install",
  uninstall: "helm-uninstall",
  delete: "helm-uninstall",
  del: "helm-uninstall",
  un: "helm-uninstall",
  rollback: "helm-rollback",
};

/** `helm <subcommand>`: install/upgrade, uninstall, rollback write to the cluster. */
export function classifyHelmAction(args: readonly string[]): DestructiveAction | null {
  const subcommand = positionalArgs(args)[0]?.toLowerCase();
  return subcommand ? (HELM_ACTION_BY_SUBCOMMAND[subcommand] ?? null) : null;
}

/**
 * `velero <resource> create|delete` and `velero install|uninstall` write to the cluster
 * (a restore writes the restored objects too); `get`, `describe`, `logs` read.
 */
export function classifyVeleroAction(args: readonly string[]): DestructiveAction | null {
  const positional = positionalArgs(args).map((a) => a.toLowerCase());
  const first = positional[0] ?? "";
  if (first === "install") return "apply-yaml";
  if (first === "uninstall") return "delete-resource";
  const verb = positional[1] ?? "";
  if (verb === "create") return "apply-yaml";
  if (verb === "delete") return "delete-resource";
  return null;
}

/**
 * Read-only check for any CLI the app runs against a cluster's kubeconfig
 * (terminal, panels, helm/velero wrappers). Tools that never take the cluster
 * kubeconfig (cloud CLIs, curl, yq...) are not cluster mutations and pass.
 */
export function checkCliReadOnly(
  clusterId: string | undefined | null,
  tool: string,
  args: readonly string[],
): ReadOnlyGuardResult {
  const cluster = getClusterSafetyInfo(clusterId);
  if (!cluster) return { blocked: false };
  let action: DestructiveAction | null = null;
  switch (tool) {
    case "kubectl":
    case "oc":
      action = classifyKubectlAction(args);
      break;
    case "helm":
      action = classifyHelmAction(args);
      break;
    case "velero":
      action = classifyVeleroAction(args);
      break;
    default:
      return { blocked: false };
  }
  if (!action) return { blocked: false };
  const check = checkActionSafety(cluster, action);
  if (check.allowed) return { blocked: false };
  return { blocked: true, reason: check.reason };
}

/**
 * Some wrappers pass the cluster only as `--kubeconfig <appdata>/configs/<key>.yaml`.
 * The file name is the registry key, so the cluster can be recovered from it.
 */
export function clusterIdFromKubeconfigArg(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    let value: string | undefined;
    if (token === "--kubeconfig") value = args[i + 1];
    else if (token.startsWith("--kubeconfig=")) value = token.slice("--kubeconfig=".length);
    if (!value) continue;
    const file = value.split(/[\\/]/).pop() ?? "";
    return file.endsWith(".yaml") ? file.slice(0, -".yaml".length) : file;
  }
  return undefined;
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
