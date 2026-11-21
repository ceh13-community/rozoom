import { safeAppLog } from "./tauri-runtime";

/**
 * logs.log lines for how the lists get their data: which watch transport a resource
 * runs on and whether it is live, which lists poll and how often, and the data mode.
 * A line is written only when that state changes, so a quiet app writes nothing.
 */

const lastState = new Map<string, string>();

function writeOnChange(key: string, state: string, line: string) {
  if (lastState.get(key) === state) return;
  lastState.set(key, state);
  void safeAppLog("info", line);
}

function firstLine(text: string, max = 160): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

const TRANSPORT_LABEL = { api: "api", fallback: "kubectl", idle: "off" } as const;

/** A resource watch changed transport (API, kubectl watch fallback, stopped) or liveness. */
export function logWatchState(
  kind: string,
  clusterId: string,
  state: { transport: keyof typeof TRANSPORT_LABEL; live: boolean; error: string | null },
) {
  const transport = TRANSPORT_LABEL[state.transport];
  const live = state.transport === "idle" ? "" : ` live=${state.live ? "yes" : "no"}`;
  const error = !state.live && state.error ? ` error="${firstLine(state.error)}"` : "";
  writeOnChange(
    `watch|${kind}|${clusterId}`,
    `${transport}|${live}`,
    `[sync] ${kind} cluster=${clusterId} watch=${transport}${live}${error}`,
  );
}

/** A list polls (instead of watching) every `refreshSeconds`. */
export function logPollSchedule(list: string, refreshSeconds: number, errorStreak: number) {
  const backoff = errorStreak > 0 ? ` (backoff after ${errorStreak} failed)` : "";
  writeOnChange(
    `poll|${list}`,
    String(refreshSeconds),
    `[sync] ${list} poll every ${refreshSeconds}s${backoff}`,
  );
}

/** A polling list stopped (closed, switched to a watch, or turned off). */
export function logPollStopped(list: string) {
  const key = `poll|${list}`;
  if (!lastState.has(key)) return;
  lastState.delete(key);
  void safeAppLog("info", `[sync] ${list} poll stopped`);
}

/** The data mode (Fast LAN, Balanced, ...) the user picked. */
export function logDataMode(name: string, previous: string) {
  if (name === previous) return;
  void safeAppLog("info", `[sync] data mode ${name} (was ${previous})`);
}

/** Forgets the last written states (tests). */
export function resetSyncLogForTests() {
  lastState.clear();
}
