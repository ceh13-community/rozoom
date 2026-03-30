/**
 * Pod Timeline
 *
 * Visual lifecycle timeline: created → scheduled → initialized →
 * containers started → running/failed. Marks restarts, OOM kills,
 * and state transitions with timestamps.
 */

type GenericItem = Record<string, unknown>;

export type TimelineEventKind =
  | "created"
  | "scheduled"
  | "initialized"
  | "container-started"
  | "container-ready"
  | "container-terminated"
  | "restart"
  | "oom-killed"
  | "pull-failed"
  | "crash-loop"
  | "evicted"
  | "deleted"
  | "warning";

export type TimelineEvent = {
  kind: TimelineEventKind;
  timestamp: number;
  label: string;
  detail: string;
  severity: "ok" | "warning" | "critical";
  container?: string;
};

export type PodTimelineResult = {
  podName: string;
  namespace: string;
  phase: string;
  events: TimelineEvent[];
  totalRestarts: number;
  oomKills: number;
  durationMs: number;
  healthSummary: "healthy" | "degraded" | "failing";
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseTs(value: unknown): number {
  if (!value) return 0;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- value is a timestamp string at runtime
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

export function buildPodTimeline(pod: GenericItem): PodTimelineResult {
  const metadata = asRecord(pod.metadata);
  const status = asRecord(pod.status);
  const spec = asRecord(pod.spec);
  const events: TimelineEvent[] = [];

  const podName = asString(metadata.name);
  const namespace = asString(metadata.namespace);
  const phase = asString(status.phase, "Unknown");
  const createdAt = parseTs(metadata.creationTimestamp);

  // Created
  if (createdAt > 0) {
    events.push({
      kind: "created",
      timestamp: createdAt,
      label: "Pod created",
      detail: `Scheduled to ${asString(spec.nodeName, "pending")}`,
      severity: "ok",
    });
  }

  // Pod conditions
  for (const cond of asArray(status.conditions)) {
    const c = asRecord(cond);
    const type = asString(c.type);
    const condStatus = asString(c.status);
    const ts = parseTs(c.lastTransitionTime);
    if (ts === 0) continue;

    if (type === "PodScheduled" && condStatus === "True") {
      events.push({
        kind: "scheduled",
        timestamp: ts,
        label: "Scheduled",
        detail: `Node: ${asString(spec.nodeName, "-")}`,
        severity: "ok",
      });
    }
    if (type === "Initialized" && condStatus === "True") {
      events.push({
        kind: "initialized",
        timestamp: ts,
        label: "Initialized",
        detail: "Init containers completed",
        severity: "ok",
      });
    }
    if (type === "Ready" && condStatus === "False") {
      events.push({
        kind: "warning",
        timestamp: ts,
        label: "Not ready",
        detail: asString(c.reason, "readiness check failed"),
        severity: "warning",
      });
    }
  }

  // Container statuses
  let totalRestarts = 0;
  let oomKills = 0;

  for (const cs of asArray(status.containerStatuses)) {
    const c = asRecord(cs);
    const containerName = asString(c.name);
    const restartCount = asNumber(c.restartCount);
    totalRestarts += restartCount;

    const state = asRecord(c.state);
    const lastState = asRecord(c.lastState);

    // Current running state
    const running = asRecord(state.running);
    if (running.startedAt) {
      events.push({
        kind: "container-started",
        timestamp: parseTs(running.startedAt),
        label: `Container started: ${containerName}`,
        detail: `Running since ${asString(running.startedAt)}`,
        severity: "ok",
        container: containerName,
      });
    }

    // Current waiting state
    const waiting = asRecord(state.waiting);
    const waitReason = asString(waiting.reason);
    if (waitReason) {
      const isCrashLoop = waitReason === "CrashLoopBackOff";
      const isPullError = waitReason.includes("Pull") || waitReason.includes("pull");
      events.push({
        kind: isCrashLoop ? "crash-loop" : isPullError ? "pull-failed" : "warning",
        timestamp: Date.now(),
        label: `Container waiting: ${containerName}`,
        detail: `${waitReason}: ${asString(waiting.message, "-")}`,
        severity: isCrashLoop || isPullError ? "critical" : "warning",
        container: containerName,
      });
    }

    // Current terminated state
    const terminated = asRecord(state.terminated);
    if (terminated.reason) {
      const isOOM = asString(terminated.reason) === "OOMKilled";
      if (isOOM) oomKills++;
      events.push({
        kind: isOOM ? "oom-killed" : "container-terminated",
        timestamp: parseTs(terminated.finishedAt) || Date.now(),
        label: `Container terminated: ${containerName}`,
        detail: `${asString(terminated.reason)} (exit: ${asNumber(terminated.exitCode)})`,
        severity: isOOM ? "critical" : "warning",
        container: containerName,
      });
    }

    // Last terminated state (previous crash)
    const lastTerminated = asRecord(lastState.terminated);
    if (lastTerminated.reason) {
      const isOOM = asString(lastTerminated.reason) === "OOMKilled";
      if (isOOM) oomKills++;
      events.push({
        kind: isOOM ? "oom-killed" : "restart",
        timestamp: parseTs(lastTerminated.finishedAt) || 0,
        label: `Previous crash: ${containerName}`,
        detail: `${asString(lastTerminated.reason)} (exit: ${asNumber(lastTerminated.exitCode)}, restarts: ${restartCount})`,
        severity: isOOM ? "critical" : "warning",
        container: containerName,
      });
    }
  }

  // Eviction
  if (phase === "Failed" && asString(status.reason) === "Evicted") {
    events.push({
      kind: "evicted",
      timestamp: Date.now(),
      label: "Pod evicted",
      detail: asString(status.message, "Node resource pressure"),
      severity: "critical",
    });
  }

  // Deletion
  if (metadata.deletionTimestamp) {
    events.push({
      kind: "deleted",
      timestamp: parseTs(metadata.deletionTimestamp),
      label: "Deletion requested",
      detail: `Grace period: ${asNumber(metadata.deletionGracePeriodSeconds)}s`,
      severity: "warning",
    });
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  const durationMs = createdAt > 0 ? Date.now() - createdAt : 0;
  const healthSummary: PodTimelineResult["healthSummary"] =
    oomKills > 0 || events.some((e) => e.kind === "crash-loop")
      ? "failing"
      : totalRestarts > 0 || events.some((e) => e.severity === "warning")
        ? "degraded"
        : "healthy";

  return {
    podName,
    namespace,
    phase,
    events,
    totalRestarts,
    oomKills,
    durationMs,
    healthSummary,
  };
}
