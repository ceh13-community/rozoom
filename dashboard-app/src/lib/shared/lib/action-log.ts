import { safeAppLog } from "./tauri-runtime";

/**
 * logs.log lines for what the user changed in a cluster (delete, scale, restart, apply...)
 * and when an open list received that change from its watch. Together with the [sync]
 * lines they answer "I deleted the pods, why did the list lag" from the log alone: when
 * the command ran, how long it took, how it ended, and how much later the list saw it.
 *
 * Only the shape of the command is logged: verb, kind, names, namespace and a few
 * harmless flags. Values of other flags (patches, literals, env) and positional
 * key=value pairs are left out.
 */

/** kubectl short names; plurals are handled by `normalizeKind`. */
const KIND_SHORT_NAMES: Record<string, string> = {
  po: "pod",
  deploy: "deployment",
  ds: "daemonset",
  sts: "statefulset",
  rs: "replicaset",
  cj: "cronjob",
  no: "node",
  cm: "configmap",
  svc: "service",
  ing: "ingress",
  ns: "namespace",
  sa: "serviceaccount",
  pvc: "persistentvolumeclaim",
  pv: "persistentvolume",
  hpa: "horizontalpodautoscaler",
  pdb: "poddisruptionbudget",
  netpol: "networkpolicy",
  ep: "endpoint",
};

/** Flags whose value is logged; every other flag is logged by name only. */
const FLAGS_WITH_SAFE_VALUE = new Set([
  "--replicas",
  "--selector",
  "-l",
  "--grace-period",
  "--cascade",
  "--wait",
  "--to-revision",
  "--container",
  "-c",
  "--force",
  "--all",
  "--all-namespaces",
  "-A",
  "--overwrite",
]);

/** Flags that take the next argument as their value when written without "=". */
const FLAGS_WITH_SEPARATE_VALUE = new Set([
  "-n",
  "--namespace",
  "-l",
  "--selector",
  "-c",
  "--container",
  "-p",
  "--patch",
  "--type",
  "-f",
  "--filename",
  "-o",
  "--output",
  "--from-literal",
  "--from-file",
  "--overrides",
  "--image",
  "--field-manager",
  "--grace-period",
  "--replicas",
  "--to-revision",
  "--timeout",
  "--context",
  "--kubeconfig",
]);

/** `rollout restart`, `set image`: the subcommand belongs to the verb. */
const VERBS_WITH_SUBCOMMAND = new Set(["rollout", "set"]);

export type KubectlMutationSummary = {
  /** The command as logged, for example `delete pod web-1 -n shop --wait=false`. */
  text: string;
  verb: string;
  /** Watch kind (`pod`, `deployment`...), null when the command names no kind. */
  kind: string | null;
  names: string[];
  namespace: string | null;
};

/**
 * One name per resource kind, so `deploy`, `deployments` and `deployment.apps` in a command
 * match the `deployment` events of a list, and `ingresses` the `ingress` ones.
 */
export function normalizeKind(raw: string): string {
  const lower = raw.toLowerCase().split(".")[0] ?? "";
  const short = KIND_SHORT_NAMES[lower];
  if (short) return short;
  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("sses")) return lower.slice(0, -2);
  if (lower.endsWith("ss")) return lower;
  if (lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

export function summarizeKubectlMutation(args: readonly string[]): KubectlMutationSummary {
  const verbParts = [args[0] ?? ""];
  let index = 1;
  if (VERBS_WITH_SUBCOMMAND.has(verbParts[0] ?? "") && args[1] && !args[1].startsWith("-")) {
    verbParts.push(args[1]);
    index = 2;
  }
  const verb = verbParts.join(" ");
  let kind: string | null = null;
  const names: string[] = [];
  let namespace: string | null = null;
  const flags: string[] = [];

  for (; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg.startsWith("-")) {
      const equals = arg.indexOf("=");
      const flag = equals === -1 ? arg : arg.slice(0, equals);
      let value: string | null = equals === -1 ? null : arg.slice(equals + 1);
      if (value === null && FLAGS_WITH_SEPARATE_VALUE.has(flag) && index + 1 < args.length) {
        index += 1;
        value = args[index] ?? null;
      }
      if (flag === "-n" || flag === "--namespace") {
        namespace = value;
      } else if (FLAGS_WITH_SAFE_VALUE.has(flag) && value !== null) {
        flags.push(`${flag}=${value}`);
      } else {
        flags.push(flag);
      }
      continue;
    }
    // key=value positionals (`set env`, `label`, `annotate`) can carry secrets.
    if (arg.includes("=")) continue;
    if (kind === null) {
      const [rawKind = "", name] = arg.split("/", 2);
      kind = normalizeKind(rawKind);
      if (name) names.push(name);
      continue;
    }
    names.push(arg);
  }

  const text = [
    verb,
    ...(kind ? [kind] : []),
    ...names,
    ...(namespace ? ["-n", namespace] : []),
    ...flags,
  ].join(" ");
  return { text, verb, kind, names, namespace };
}

type PendingFollow = {
  verb: string;
  kind: string;
  name: string;
  namespace: string | null;
  startedAt: number;
  firstSeen: boolean;
  timer: ReturnType<typeof setTimeout>;
};

/** How long a change is watched for in the open lists before the log says it was not seen. */
export const FOLLOW_WINDOW_MS = 120_000;
/** A bulk delete follows at most this many objects; the rest are only in the command line. */
const MAX_FOLLOWS_PER_COMMAND = 50;

const pending = new Map<string, PendingFollow>();

function followKey(clusterId: string, kind: string, name: string) {
  return `${clusterId}|${kind}|${name}`;
}

function firstLine(text: string, max = 200): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

function describeTarget(kind: string, namespace: string | null, name: string) {
  return `${kind} ${namespace ? `${namespace}/` : ""}${name}`;
}

export type StartedKubectlMutation = {
  summary: KubectlMutationSummary;
  clusterId?: string;
  startedAt: number;
  followKeys: string[];
};

/**
 * Call right before a mutating command runs. The objects it names are followed from now
 * on: a watch event can reach the list before the kubectl process has exited.
 */
export function startKubectlMutation(
  args: readonly string[],
  clusterId?: string,
  now = Date.now(),
): StartedKubectlMutation {
  const summary = summarizeKubectlMutation(args);
  const followKeys: string[] = [];
  if (clusterId && summary.kind) {
    for (const name of summary.names.slice(0, MAX_FOLLOWS_PER_COMMAND)) {
      followKeys.push(follow(clusterId, summary, name, now));
    }
  }
  return { summary, clusterId, startedAt: now, followKeys };
}

/** One line for the finished command. A failed command's objects are no longer followed. */
export function finishKubectlMutation(
  started: StartedKubectlMutation,
  result: { code: number; stderr?: string },
  now = Date.now(),
): string {
  const { summary } = started;
  const cluster = started.clusterId ? ` cluster=${started.clusterId}` : "";
  const duration = `duration=${now - started.startedAt}ms`;
  const line =
    result.code === 0
      ? `[action] kubectl ${summary.text}${cluster} result=ok ${duration}`
      : `[action] kubectl ${summary.text}${cluster} result=failed code=${result.code} ${duration} error="${firstLine(result.stderr ?? "")}"`;
  void safeAppLog(result.code === 0 ? "info" : "warn", line);
  if (result.code !== 0) {
    for (const key of started.followKeys) {
      const entry = pending.get(key);
      if (entry?.startedAt !== started.startedAt) continue;
      clearTimeout(entry.timer);
      pending.delete(key);
    }
  }
  return line;
}

/** One line for a mutating command the app refused to run (read-only cluster). */
export function logBlockedKubectlMutation(
  args: readonly string[],
  clusterId: string | undefined,
  reason: string,
): string {
  const summary = summarizeKubectlMutation(args);
  const cluster = clusterId ? ` cluster=${clusterId}` : "";
  const line = `[action] kubectl ${summary.text}${cluster} result=blocked reason="${firstLine(reason)}"`;
  void safeAppLog("warn", line);
  return line;
}

function follow(
  clusterId: string,
  summary: KubectlMutationSummary,
  name: string,
  now: number,
): string {
  const kind = summary.kind ?? "";
  const key = followKey(clusterId, kind, name);
  const previous = pending.get(key);
  if (previous) clearTimeout(previous.timer);
  const entry: PendingFollow = {
    verb: summary.verb,
    kind,
    name,
    namespace: summary.namespace,
    startedAt: now,
    firstSeen: false,
    timer: setTimeout(() => {
      if (pending.get(key) !== entry) return;
      pending.delete(key);
      const what = entry.firstSeen
        ? "not removed from the open lists"
        : "no update in the open lists";
      void safeAppLog(
        "info",
        `[action] ${describeTarget(kind, entry.namespace, name)}: ${what} within ${FOLLOW_WINDOW_MS / 1000}s after ${entry.verb} started (no watched list, a polled list, or the change is still running)`,
      );
    }, FOLLOW_WINDOW_MS),
  };
  pending.set(key, entry);
  return key;
}

type WatchEventLike = {
  type?: unknown;
  object?: { metadata?: { name?: unknown; namespace?: unknown } };
};

/** The watch event and its kind; configuration lists wrap it as { workloadType, event }. */
function watchEventOf(
  kind: string,
  payload: unknown,
): { kind: string; event: WatchEventLike } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { event?: unknown; workloadType?: unknown };
  if (typeof record.workloadType === "string" && record.event && typeof record.event === "object") {
    return { kind: record.workloadType, event: record.event as WatchEventLike };
  }
  return { kind, event: record as WatchEventLike };
}

/**
 * Called for every event the open lists receive. Logs when a followed object first shows
 * up changed, and for a delete when it is gone from the list.
 */
export function noteClusterEvent(
  event: { clusterId: string; kind: string; payload: unknown },
  now = Date.now(),
) {
  if (pending.size === 0) return;
  const unwrapped = watchEventOf(event.kind, event.payload);
  const watchEvent = unwrapped?.event;
  const metadata = watchEvent?.object?.metadata;
  const name = typeof metadata?.name === "string" ? metadata.name : null;
  if (!unwrapped || !name) return;
  const key = followKey(event.clusterId, normalizeKind(unwrapped.kind), name);
  const entry = pending.get(key);
  if (!entry) return;
  const namespace = typeof metadata?.namespace === "string" ? metadata.namespace : null;
  if (entry.namespace && namespace && entry.namespace !== namespace) return;

  const type = typeof watchEvent?.type === "string" ? watchEvent.type : "UPDATE";
  const after = now - entry.startedAt;
  const target = describeTarget(entry.kind, namespace ?? entry.namespace, name);
  const isDelete = entry.verb === "delete";
  if (!entry.firstSeen && !(isDelete && type === "DELETED")) {
    entry.firstSeen = true;
    void safeAppLog(
      "info",
      `[action] ${target}: list got ${type} ${after}ms after ${entry.verb} started`,
    );
    if (!isDelete) {
      clearTimeout(entry.timer);
      pending.delete(key);
    }
    return;
  }
  if (isDelete && type === "DELETED") {
    clearTimeout(entry.timer);
    pending.delete(key);
    void safeAppLog(
      "info",
      `[action] ${target}: removed from the list ${after}ms after delete started`,
    );
  }
}

/** Drops all follows (tests). */
export function resetActionLogForTests() {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}
