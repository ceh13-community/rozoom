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

// Flags that make kubectl read a kuberc file: aliases and defaults from a user file would
// change what a verb means, so on a read-only cluster the flag itself is refused.
const KUBERC_FLAGS = /^--kuberc(=|$)/;

// Global kubectl / oc / helm / velero flags that consume the next token when written
// without `=`. Needed to find the verb in terminal input such as
// `kubectl -n prod delete pod x`.
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-n",
  "--namespace",
  "--context",
  "--cluster",
  "--user",
  "--kubeconfig",
  "--kuberc",
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
  "--burst-limit",
  "--qps",
  "--kubecontext",
  "--features",
  "--as-user-extra",
  "--content-cache",
  "--log_dir",
  "--log_file",
  "--reject-methods",
  "--accept-hosts",
  "--accept-paths",
  "--reject-paths",
  "--address",
  "--port",
  "--api-prefix",
  "--unix-socket",
  "--keepalive",
  "--www",
  "--www-prefix",
]);

// Global flags that take no value. Anything else that starts with "-" and appears before
// the verb must be a known value flag, or the command counts as a write: an unknown flag
// may swallow the next token (`--as-user-extra get delete pod x` deletes), and the guard
// cannot know which tokens a flag it has never seen will eat.
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "-h",
  "--help",
  "--insecure-skip-tls-verify",
  "--kube-insecure-skip-tls-verify",
  "--match-server-version",
  "--warnings-as-errors",
  "--disable-compression",
  "--debug",
  "--alsologtostderr",
  "--logtostderr",
  "--skip-headers",
  "--skip-log-headers",
  "--one-output",
  "--add-dir-header",
]);

type ParsedArgs = {
  /** Non-flag tokens, verb first. */
  positional: string[];
  /** A flag before the verb that the tables do not know: it may hide the real verb. */
  unknownFlagBeforeVerb: boolean;
  /** An empty token: kubectl skips it, so `"" delete ...` is a delete. */
  emptyPositional: boolean;
};

/**
 * Splits a CLI invocation into positionals and the two shapes that must count as a
 * write on a read-only cluster regardless of the verb they seem to carry.
 */
function parseCliArgs(args: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let unknownFlagBeforeVerb = false;
  let emptyPositional = false;
  for (let i = 0; i < args.length; i++) {
    const raw = args[i] ?? "";
    const token = raw.trim();
    if (token === "") {
      emptyPositional = true;
      continue;
    }
    if (token === "--") {
      for (const rest of args.slice(i + 1)) {
        const t = rest.trim();
        if (t === "") emptyPositional = true;
        else positional.push(t);
      }
      break;
    }
    if (token.startsWith("-")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      if (eq === -1 && VALUE_FLAGS.has(name)) {
        i++; // the next token is this flag's value
        continue;
      }
      if (VALUE_FLAGS.has(name) || BOOLEAN_FLAGS.has(name)) continue;
      if (positional.length === 0) unknownFlagBeforeVerb = true;
      continue;
    }
    positional.push(token);
  }
  return { positional, unknownFlagBeforeVerb, emptyPositional };
}

/** Positional tokens with global flags (and their values) removed. */
function positionalArgs(args: readonly string[]): string[] {
  return parseCliArgs(args).positional;
}

/** The two parser verdicts that are writes on their own, before any verb is read. */
function unsafeShape(parsed: ParsedArgs): boolean {
  return parsed.unknownFlagBeforeVerb || parsed.emptyPositional;
}

/**
 * Read-only classification is an allow list (decision 09/11/2026, card 4ZHgH8gN): a
 * command is a read only when its verb (and, where it matters, its subcommand) is
 * listed here. Everything else counts as a write and is refused on a read-only
 * cluster, including verbs nobody has thought of yet, kuberc aliases and plugins.
 * The DestructiveAction only names the write for the reason text.
 */

// kubectl verbs whose every form only reads from the cluster or stays on this machine.
const KUBECTL_READ_VERBS: ReadonlySet<string> = new Set([
  "get",
  "describe",
  "logs",
  "log",
  "top",
  "explain",
  "api-resources",
  "api-versions",
  "version",
  "cluster-info",
  "events",
  "wait",
  "diff",
  "port-forward",
  "completion",
  "options",
  "help",
  "kustomize",
  "convert",
]);

// Verbs with a mixed subcommand set: only these subcommands read.
const KUBECTL_READ_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  rollout: new Set(["status", "history"]),
  auth: new Set(["can-i", "whoami"]),
  config: new Set(["view", "get-contexts", "get-clusters", "get-users", "current-context"]),
  plugin: new Set(["list"]),
  // oc only: the cluster-admin tree. Inspections read; everything else there writes.
  // `adm release` is handled below: only `info` and `extract` read.
  adm: new Set(["top", "inspect", "node-logs"]),
};

// oc verbs that read on top of the kubectl set.
const OC_READ_VERBS: ReadonlySet<string> = new Set([
  "status",
  "whoami",
  "projects",
  "project",
  "explain",
]);

// oc verbs whose subcommands split: `image mirror|append` and `adm release new` push to a
// registry, `registry login` writes local config. Only these subcommands read.
const OC_READ_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  image: new Set(["info", "extract"]),
  registry: new Set(["info"]),
};
const OC_ADM_RELEASE_READ: ReadonlySet<string> = new Set(["info", "extract"]);

// `kubectl proxy` only reads when it refuses every writing method itself. The app's own
// proxy (kube-api-proxy.ts) passes exactly this; a terminal `kubectl proxy` does not.
const PROXY_REJECTS_WRITES = /^--reject-methods=(.*)$/;
function proxyRejectsWrites(args: readonly string[]): boolean {
  for (const arg of args) {
    const m = PROXY_REJECTS_WRITES.exec(arg.trim());
    if (!m) continue;
    const pattern = m[1];
    return ["POST", "PUT", "PATCH", "DELETE"].every((method) => pattern.includes(method));
  }
  return false;
}

// Named writes, for the reason text and the UI category. Anything not listed here and
// not in the read sets is a generic write.
const KUBECTL_WRITE_ACTION: Readonly<Record<string, DestructiveAction>> = {
  delete: "delete-resource",
  evict: "delete-pod",
  scale: "scale-workload",
  autoscale: "scale-workload",
  apply: "apply-yaml",
  create: "apply-yaml",
  replace: "apply-yaml",
  run: "apply-yaml",
  expose: "apply-yaml",
  exec: "exec-shell",
  attach: "exec-shell",
  debug: "exec-shell",
  cp: "exec-shell",
  proxy: "exec-shell",
};

const ROLLOUT_WRITE_ACTION: Readonly<Record<string, DestructiveAction>> = {
  restart: "restart-workload",
  pause: "restart-workload",
  resume: "restart-workload",
  undo: "rollback-workload",
};

const GENERIC_WRITE: DestructiveAction = "edit-resource";

/**
 * Map a kubectl (or oc) invocation to the DestructiveAction it performs, or null when it
 * only reads. App call-sites build verb-first args; terminal input may put global flags
 * first, so the verb is the first positional token.
 */
export function classifyKubectlAction(
  args: readonly string[],
  tool: "kubectl" | "oc" = "kubectl",
): DestructiveAction | null {
  if (args.some((arg) => KUBERC_FLAGS.test(arg.trim()))) return GENERIC_WRITE;
  const parsed = parseCliArgs(args);
  if (unsafeShape(parsed)) return GENERIC_WRITE;
  const positional = parsed.positional.map((a) => a.toLowerCase());
  const verb = positional[0];
  if (!verb) return null;
  if (verb === "proxy") return proxyRejectsWrites(args) ? null : "exec-shell";
  if (KUBECTL_READ_VERBS.has(verb)) return null;
  if (tool === "oc" && OC_READ_VERBS.has(verb)) return null;
  if (tool === "oc" && Object.hasOwn(OC_READ_SUBCOMMANDS, verb)) {
    return OC_READ_SUBCOMMANDS[verb].has(positional[1] ?? "") ? null : GENERIC_WRITE;
  }
  if (tool === "oc" && verb === "adm" && positional[1] === "release") {
    return OC_ADM_RELEASE_READ.has(positional[2] ?? "") ? null : GENERIC_WRITE;
  }
  if (Object.hasOwn(KUBECTL_READ_SUBCOMMANDS, verb)) {
    const subcommand = positional[1] ?? "";
    if (KUBECTL_READ_SUBCOMMANDS[verb].has(subcommand)) return null;
    if (verb === "rollout") return ROLLOUT_WRITE_ACTION[subcommand] ?? GENERIC_WRITE;
    return GENERIC_WRITE;
  }
  if (verb === "delete") {
    const target = positional[1] ?? "";
    const isPod = target === "pod" || target === "pods" || target.startsWith("pod/");
    return isPod ? "delete-pod" : "delete-resource";
  }
  return KUBECTL_WRITE_ACTION[verb] ?? GENERIC_WRITE;
}

// helm subcommands that read from the cluster or stay on this machine (repos, registries,
// chart rendering). `test` runs pods, `install`/`upgrade`/`uninstall`/`rollback` write.
const HELM_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "list",
  "ls",
  "status",
  "history",
  "hist",
  "get",
  "show",
  "inspect",
  "search",
  "repo",
  "env",
  "version",
  "template",
  "lint",
  "verify",
  "pull",
  "fetch",
  "dependency",
  "dep",
  "completion",
  "help",
  "registry",
  "plugin",
]);

const HELM_WRITE_ACTION: Readonly<Record<string, DestructiveAction>> = {
  install: "helm-install",
  upgrade: "helm-install",
  uninstall: "helm-uninstall",
  delete: "helm-uninstall",
  del: "helm-uninstall",
  un: "helm-uninstall",
  rollback: "helm-rollback",
};

/** `helm <subcommand>`: null for the read list, a write action for everything else. */
export function classifyHelmAction(args: readonly string[]): DestructiveAction | null {
  const parsed = parseCliArgs(args);
  if (unsafeShape(parsed)) return GENERIC_WRITE;
  const subcommand = parsed.positional[0]?.toLowerCase();
  if (!subcommand) return null;
  if (HELM_READ_SUBCOMMANDS.has(subcommand)) return null;
  return HELM_WRITE_ACTION[subcommand] ?? GENERIC_WRITE;
}

// velero: `<resource> get|describe|logs|download` and the client-side commands read;
// `create`, `delete`, `install`, `uninstall`, `plugin add`, `set`, `pause` ... write.
const VELERO_READ_COMMANDS: ReadonlySet<string> = new Set([
  "version",
  "completion",
  "help",
  "client",
  "debug",
  "bug",
]);
const VELERO_READ_VERBS: ReadonlySet<string> = new Set(["get", "describe", "logs", "download"]);

/** velero: null for reads, a write action for everything else. */
export function classifyVeleroAction(args: readonly string[]): DestructiveAction | null {
  const parsed = parseCliArgs(args);
  if (unsafeShape(parsed)) return GENERIC_WRITE;
  const positional = parsed.positional.map((a) => a.toLowerCase());
  const first = positional[0];
  if (!first) return null;
  if (VELERO_READ_COMMANDS.has(first)) return null;
  if (first === "install") return "apply-yaml";
  if (first === "uninstall") return "delete-resource";
  // Verb-first form (`velero get backups`, `velero delete backup x`) is valid too.
  if (VELERO_READ_VERBS.has(first)) return null;
  if (first === "create") return "apply-yaml";
  if (first === "delete") return "delete-resource";
  const verb = positional[1] ?? "";
  if (VELERO_READ_VERBS.has(verb)) return null;
  if (verb === "create") return "apply-yaml";
  if (verb === "delete") return "delete-resource";
  return GENERIC_WRITE;
}

// `trivy k8s` deploys a node-collector (namespace + jobs) unless told not to; measured on
// trivy 0.70.0: POST /api/v1/namespaces and POST .../trivy-temp/jobs. Image, fs and config
// scans never touch the cluster.
const TRIVY_NO_NODE_COLLECTOR = /^--disable-node-collector(=true)?$/;

/** trivy: `k8s` without --disable-node-collector writes to the cluster. */
export function classifyTrivyAction(args: readonly string[]): DestructiveAction | null {
  const positional = positionalArgs(args).map((a) => a.toLowerCase());
  const first = positional[0];
  if (first !== "k8s" && first !== "kubernetes") return null;
  return args.some((arg) => TRIVY_NO_NODE_COLLECTOR.test(arg.trim())) ? null : "apply-yaml";
}

function evaluate(
  clusterId: string | undefined | null,
  action: DestructiveAction | null,
): ReadOnlyGuardResult {
  if (!action) return { blocked: false };
  if (!clusterId) return { blocked: false }; // no cluster named: not a managed-cluster call
  const cluster = getClusterSafetyInfo(clusterId);
  if (!cluster) {
    // Fail closed: a write aimed at a cluster the registry does not know is refused.
    // The registry is filled from clustersList on load, so this only fires for an id
    // that was never a managed cluster (typo, stale route, removed cluster).
    return {
      blocked: true,
      reason: `Cluster "${clusterId}" is not registered. The write was not run.`,
    };
  }
  const check = checkActionSafety(cluster, action);
  if (check.allowed) return { blocked: false };
  return { blocked: true, reason: check.reason };
}

/**
 * Read-only check for any CLI the app runs against a cluster's kubeconfig (terminal,
 * panels, helm/velero wrappers, trivy k8s). Tools that never take the cluster kubeconfig
 * (cloud CLIs, curl, yq...) are not cluster writes and pass; the terminal refuses the
 * shell and names the cloud CLIs in the Read-only tooltip instead.
 */
export function checkCliReadOnly(
  clusterId: string | undefined | null,
  tool: string,
  args: readonly string[],
): ReadOnlyGuardResult {
  switch (tool) {
    case "kubectl":
      return evaluate(clusterId, classifyKubectlAction(args, "kubectl"));
    case "oc":
      return evaluate(clusterId, classifyKubectlAction(args, "oc"));
    case "helm":
      return evaluate(clusterId, classifyHelmAction(args));
    case "velero":
      return evaluate(clusterId, classifyVeleroAction(args));
    case "trivy":
      return evaluate(clusterId, classifyTrivyAction(args));
    default:
      return { blocked: false };
  }
}

/**
 * Some wrappers pass the cluster only as `--kubeconfig <appdata>/configs/<key>.yaml`.
 * The file name is the registry key, so the cluster can be recovered from it. kubectl
 * honours the last occurrence of the flag, so does this.
 */
export function clusterIdFromKubeconfigArg(args: readonly string[]): string | undefined {
  let found: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    let value: string | undefined;
    if (token === "--kubeconfig") value = args[i + 1];
    else if (token.startsWith("--kubeconfig=")) value = token.slice("--kubeconfig=".length);
    if (!value) continue;
    const file = value.split(/[\\/]/).pop() ?? "";
    found = file.endsWith(".yaml") ? file.slice(0, -".yaml".length) : file;
  }
  return found;
}

export type ReadOnlyGuardResult = {
  blocked: boolean;
  reason?: string;
};

/**
 * Hard block for the execution boundary: deny writes on read-only clusters and on
 * clusters the registry does not know. Confirmation flows (prod clusters) stay in the
 * UI via guardedAction; the boundary only enforces outright denials so it never has to
 * render a dialog.
 */
export function checkKubectlReadOnly(
  clusterId: string | undefined | null,
  args: readonly string[],
): ReadOnlyGuardResult {
  return evaluate(clusterId, classifyKubectlAction(args, "kubectl"));
}

export function checkHelmActionReadOnly(
  clusterId: string | undefined | null,
  action: Extract<DestructiveAction, "helm-install" | "helm-uninstall" | "helm-rollback">,
): ReadOnlyGuardResult {
  return evaluate(clusterId, action);
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
