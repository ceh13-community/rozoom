import { isTauriAvailable } from "./tauri-runtime";

/** The last kubectl lines kept per forward for the tab's compact log. */
export const PORT_FORWARD_LOG_LINES = 40;
/** Default wait for the Test button before the request is given up. */
export const PORT_FORWARD_TEST_TIMEOUT_MS = 5_000;

const HANDLING_CONNECTION = /Handling connection for \d+/;

/** kubectl prints one such line per local connection it accepted. */
export function isHandlingConnectionLine(line: string): boolean {
  return HANDLING_CONNECTION.test(line);
}

function timeOfDay(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Appends one line with its time and keeps the newest PORT_FORWARD_LOG_LINES. */
export function appendForwardLog(
  log: readonly string[],
  line: string,
  at: number = Date.now(),
): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [...log];
  const next = [...log, `${timeOfDay(at)}  ${trimmed}`];
  return next.length > PORT_FORWARD_LOG_LINES
    ? next.slice(next.length - PORT_FORWARD_LOG_LINES)
    : next;
}

/** "12s", "3m 05s", "1h 02m", "2d 03h": what a status line shows for an uptime. */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${two(total % 60)}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${two(minutes % 60)}m`;
  return `${Math.floor(hours / 24)}d ${two(hours % 24)}h`;
}

export type PortForwardState = "starting" | "active" | "stopped" | "error";

export type PortForwardStatus = {
  state: PortForwardState;
  /** The word on the badge. */
  label: string;
  startedAt: number | null;
  closedAt: number | null;
  /** Local connections kubectl accepted so far. */
  connections: number;
  /** kubectl's error line, when the state is error. */
  detail: string | null;
};

/** The fields of a PortForwardProcess the status reads; a plain object in tests. */
export type ForwardLike = {
  isRunning: boolean;
  startedAt: number;
  closedAt: number | null;
  lastMessage: string | null;
  lastError: string | null;
  connections?: number;
};

/** One rule for the status line of every port-forward tab. */
export function describePortForwardState(
  forward: ForwardLike | null | undefined,
): PortForwardStatus {
  if (!forward) {
    return {
      state: "stopped",
      label: "Not running",
      startedAt: null,
      closedAt: null,
      connections: 0,
      detail: null,
    };
  }
  const base = {
    startedAt: forward.startedAt,
    closedAt: forward.closedAt,
    connections: forward.connections ?? 0,
    detail: forward.lastError,
  };
  if (!forward.isRunning) {
    return forward.lastError
      ? { ...base, state: "error", label: "Failed" }
      : { ...base, state: "stopped", label: "Stopped" };
  }
  if (forward.lastError) return { ...base, state: "error", label: "Error" };
  if (forward.lastMessage?.startsWith("Starting"))
    return { ...base, state: "starting", label: "Starting" };
  return { ...base, state: "active", label: "Active" };
}

export type PortForwardTestResult = {
  ok: boolean;
  /** HTTP status, or null when no response came back. */
  status: number | null;
  ms: number;
  error: string | null;
};

/**
 * One GET through the forward, timed. The desktop runtime sends it from the Rust side (the
 * HTTP plugin's scope allows 127.0.0.1); elsewhere the global fetch is used. A 2xx or 3xx
 * answer is ok: the service answered through the tunnel. 4xx and 5xx are shown as they are,
 * since a tunnel that returns 404 still works. No answer within the timeout is a failure.
 */
export async function testPortForwardUrl(
  url: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
): Promise<PortForwardTestResult> {
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? PORT_FORWARD_TEST_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? (await pickFetch());
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const started = now();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    const ms = Math.max(0, Math.round(now() - started));
    const status = response.status;
    const ok = status >= 200 && status < 400;
    return { ok, status, ms, error: ok ? null : `HTTP ${status}` };
  } catch (error) {
    const ms = Math.max(0, Math.round(now() - started));
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: null,
      ms,
      error: aborted
        ? `No answer within ${Math.round(timeoutMs / 1000)} s`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pickFetch(): Promise<typeof fetch> {
  if (!isTauriAvailable()) return fetch;
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch as typeof fetch;
}
