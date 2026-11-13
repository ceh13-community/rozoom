import { error as writeErrorLine } from "@tauri-apps/plugin-log";
import { redactSecrets } from "./log-redaction";
import { isTauriAvailable } from "./tauri-runtime";

/**
 * Uncaught JS errors go to logs.log.
 *
 * Without this, a render exception or a rejected promise left no trace in the log file,
 * and the log file (via "Copy details for support" or the logs folder) is the only thing
 * a user can send us. A page that stopped rendering then looked exactly like a WebKit
 * paint problem. With it, an empty log for that minute rules the JS side out.
 *
 * Bounded on purpose: a render loop can throw hundreds of times a second, so repeats of
 * the same error within a minute are counted and written as one summary line when the
 * minute ends, and there is a per-minute line cap.
 */

export type JsErrorSource = "window.error" | "unhandledrejection" | "render";

export const JS_ERROR_LIMIT_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const MAX_STACK_FRAMES = 12;
const MAX_LINE_CHARS = 4_000;
// Dedup key length: long messages that differ only at the end count as one error.
const MAX_KEY_CHARS = 200;

export function describeError(value: unknown): string {
  if (value instanceof Error) {
    const header = `${value.name}: ${value.message}`;
    const stack = (value.stack ?? "").trim();
    const frames = (stack.startsWith(header) ? stack.slice(header.length) : stack)
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .slice(0, MAX_STACK_FRAMES);
    return [header, ...frames].join("\n");
  }
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    // JSON.stringify returns undefined for functions and symbols despite its typing.
    return (JSON.stringify(value) as string | undefined) ?? typeof value;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export interface JsErrorLogger {
  report(source: JsErrorSource, error: unknown, where?: string): void;
}

interface LoggerOptions {
  /** May return a promise; a rejection is swallowed. */
  write: (line: string) => unknown;
  now?: () => number;
  /** Timer used to write pending repeat counts; injectable for tests. */
  schedule?: (callback: () => void, delayMs: number) => void;
}

interface WrittenEntry {
  at: number;
  header: string;
  suppressed: number;
}

export function createJsErrorLogger({
  write,
  now = Date.now,
  schedule = (callback, delayMs) => {
    setTimeout(callback, delayMs);
  },
}: LoggerOptions): JsErrorLogger {
  const lastWritten = new Map<string, WrittenEntry>();
  let windowStart = Number.NEGATIVE_INFINITY;
  let linesInWindow = 0;
  let capNoticeWritten = false;
  let flushPending = false;

  function safeWrite(line: string) {
    try {
      const result = write(
        line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}...` : line,
      );
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // The logger must never become the next uncaught error.
    }
  }

  // An entry lives for one window after its line was written. When it expires, its repeat
  // count (if any) is written and the entry is dropped, so the map stays small and a count
  // is never lost just because the error stopped happening.
  function flushExpired(at: number) {
    for (const [key, entry] of lastWritten) {
      if (at - entry.at < WINDOW_MS) continue;
      if (entry.suppressed > 0) {
        safeWrite(
          `${entry.header} (repeated ${entry.suppressed} more times within a minute, not logged)`,
        );
      }
      lastWritten.delete(key);
    }
  }

  function scheduleFlush() {
    if (flushPending) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const entry of lastWritten.values()) {
      if (entry.suppressed > 0) earliest = Math.min(earliest, entry.at + WINDOW_MS);
    }
    if (earliest === Number.POSITIVE_INFINITY) return;
    flushPending = true;
    schedule(
      () => {
        flushPending = false;
        try {
          flushExpired(now());
          scheduleFlush();
        } catch {
          // Never throw from a timer either.
        }
      },
      Math.max(0, earliest - now()),
    );
  }

  return {
    report(source, error, where) {
      try {
        const at = now();
        flushExpired(at);
        if (at - windowStart >= WINDOW_MS) {
          windowStart = at;
          linesInWindow = 0;
          capNoticeWritten = false;
        }

        const description = redactSecrets(describeError(error));
        const [firstLine, ...rest] = description.split("\n");
        const key = `${source}|${firstLine.slice(0, MAX_KEY_CHARS)}`;
        const previous = lastWritten.get(key);
        if (previous) {
          previous.suppressed += 1;
          scheduleFlush();
          return;
        }

        if (linesInWindow >= JS_ERROR_LIMIT_PER_MINUTE) {
          if (!capNoticeWritten) {
            capNoticeWritten = true;
            safeWrite(
              `[js] limit of ${JS_ERROR_LIMIT_PER_MINUTE} JS errors per minute reached, the rest of this minute is not logged`,
            );
          }
          return;
        }

        const header = `[js:${source}] ${where ? `${where} ` : ""}${firstLine}`;
        lastWritten.set(key, { at, header, suppressed: 0 });
        linesInWindow += 1;
        safeWrite([header, ...rest].join("\n"));
      } catch {
        // Same rule as safeWrite: reporting an error must not throw one.
      }
    },
  };
}

function writeToAppLog(line: string): Promise<void> | null {
  return isTauriAvailable() ? writeErrorLine(line) : null;
}

export const jsErrorLog = createJsErrorLogger({ write: writeToAppLog });

export function reportJsError(source: JsErrorSource, error: unknown, where?: string) {
  jsErrorLog.report(source, error, where);
}

/** Wires window "error" and "unhandledrejection" to the logger. Returns the uninstaller. */
export function installGlobalErrorLogging(
  target: Window = window,
  logger: JsErrorLogger = jsErrorLog,
): () => void {
  const onError = (event: Event) => {
    // Resource load failures (<img>, <script>) arrive as plain Events, not ErrorEvents.
    if (!(event instanceof ErrorEvent)) return;
    if (event.error !== undefined && event.error !== null) {
      logger.report("window.error", event.error);
      return;
    }
    const position = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : "";
    logger.report("window.error", `${event.message || "unknown error"}${position}`);
  };
  const onRejection = (event: Event) => {
    logger.report("unhandledrejection", (event as PromiseRejectionEvent).reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
