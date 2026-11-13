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
 * the same error are counted instead of written, and there is a per-minute line cap.
 */

export type JsErrorSource = "window.error" | "unhandledrejection" | "render";

export const JS_ERROR_LIMIT_PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const MAX_STACK_FRAMES = 12;
const MAX_LINE_CHARS = 4_000;

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
}

export function createJsErrorLogger({ write, now = Date.now }: LoggerOptions): JsErrorLogger {
  const lastWritten = new Map<string, { at: number; suppressed: number }>();
  let windowStart = Number.NEGATIVE_INFINITY;
  let linesInWindow = 0;
  let capNoticeWritten = false;

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

  return {
    report(source, error, where) {
      try {
        const at = now();
        if (at - windowStart >= WINDOW_MS) {
          windowStart = at;
          linesInWindow = 0;
          capNoticeWritten = false;
          for (const [key, entry] of lastWritten) {
            if (at - entry.at >= WINDOW_MS && entry.suppressed === 0) lastWritten.delete(key);
          }
        }

        const description = redactSecrets(describeError(error));
        const [firstLine, ...rest] = description.split("\n");
        const key = `${source}|${firstLine}`;
        const previous = lastWritten.get(key);
        if (previous && at - previous.at < WINDOW_MS) {
          previous.suppressed += 1;
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

        const repeats = previous?.suppressed ? ` (${previous.suppressed} repeats not logged)` : "";
        const place = where ? `${where} ` : "";
        lastWritten.set(key, { at, suppressed: 0 });
        linesInWindow += 1;
        safeWrite([`[js:${source}] ${place}${firstLine}${repeats}`, ...rest].join("\n"));
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
