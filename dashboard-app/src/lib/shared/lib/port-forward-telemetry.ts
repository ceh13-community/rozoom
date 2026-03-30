import { telemetryEventBus } from "$shared/lib/telemetry-event-bus";

export type PortForwardTelemetrySnapshot = {
  startAttempts: number;
  startSuccesses: number;
  startFailures: number;
  stopAttempts: number;
  stopSuccesses: number;
  stopFailures: number;
  timeoutFailures: number;
};

const counters: PortForwardTelemetrySnapshot = {
  startAttempts: 0,
  startSuccesses: 0,
  startFailures: 0,
  stopAttempts: 0,
  stopSuccesses: 0,
  stopFailures: 0,
  timeoutFailures: 0,
};

function increment(key: keyof PortForwardTelemetrySnapshot) {
  counters[key] += 1;
}

function emitDebugEvent(event: string, payload: Record<string, unknown>) {
  telemetryEventBus.emit({
    source: "port-forward",
    name: event,
    at: Date.now(),
    payload,
  });
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("port-forward:telemetry", { detail: { event, ...payload } }),
  );
}

export function trackPortForwardStartAttempt(details: {
  uniqueKey: string;
  clusterId?: string;
  namespace?: string;
  resource?: string;
}) {
  increment("startAttempts");
  emitDebugEvent("start_attempt", details);
}

export function trackPortForwardStartResult(details: {
  uniqueKey: string;
  success: boolean;
  reason?: "timeout" | "error" | "duplicate";
  clusterId?: string;
  namespace?: string;
  resource?: string;
}) {
  if (details.success) {
    increment("startSuccesses");
  } else {
    increment("startFailures");
    if (details.reason === "timeout") increment("timeoutFailures");
  }
  emitDebugEvent("start_result", details);
}

export function trackPortForwardStopAttempt(details: {
  uniqueKey: string;
  clusterId?: string;
  namespace?: string;
  resource?: string;
}) {
  increment("stopAttempts");
  emitDebugEvent("stop_attempt", details);
}

export function trackPortForwardStopResult(details: {
  uniqueKey: string;
  success: boolean;
  clusterId?: string;
  namespace?: string;
  resource?: string;
}) {
  if (details.success) increment("stopSuccesses");
  else increment("stopFailures");
  emitDebugEvent("stop_result", details);
}

export function getPortForwardTelemetrySnapshot(): PortForwardTelemetrySnapshot {
  return { ...counters };
}

export function resetPortForwardTelemetry() {
  for (const key of Object.keys(counters) as Array<keyof PortForwardTelemetrySnapshot>) {
    counters[key] = 0;
  }
  telemetryEventBus.clearBySource("port-forward");
}

export function listPortForwardTelemetryEvents() {
  return telemetryEventBus.list().filter((event) => event.source === "port-forward");
}
