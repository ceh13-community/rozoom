import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJsErrorLogger,
  describeError,
  installGlobalErrorLogging,
  JS_ERROR_LIMIT_PER_MINUTE,
} from "./js-error-log";

// Fake clock and timers: advance() moves the clock and runs the timers that came due.
function makeLogger(start = 1_000_000) {
  const lines: string[] = [];
  let clock = start;
  let timers: Array<{ due: number; callback: () => void }> = [];
  const logger = createJsErrorLogger({
    write: (line) => {
      lines.push(line);
    },
    now: () => clock,
    schedule: (callback, delayMs) => {
      timers.push({ due: clock + delayMs, callback });
    },
  });
  return {
    lines,
    logger,
    pendingTimers: () => timers.length,
    advance(ms: number) {
      clock += ms;
      const due = timers.filter((timer) => timer.due <= clock);
      timers = timers.filter((timer) => timer.due > clock);
      for (const timer of due) timer.callback();
    },
  };
}

describe("describeError", () => {
  it("puts name and message first even when the stack omits them (WebKit format)", () => {
    const error = new TypeError("undefined is not an object (evaluating 'row.metadata.name')");
    error.stack = "renderRow@tauri://localhost/_app/immutable/nodes/4.js:12:34\nflush@...";
    expect(describeError(error)).toBe(
      "TypeError: undefined is not an object (evaluating 'row.metadata.name')\n" +
        "renderRow@tauri://localhost/_app/immutable/nodes/4.js:12:34\nflush@...",
    );
  });

  it("does not repeat the header when the stack already starts with it (V8 format)", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at f (a.js:1:1)";
    expect(describeError(error)).toBe("Error: boom\n    at f (a.js:1:1)");
  });

  it("keeps only the first stack frames", () => {
    const error = new Error("deep");
    error.stack = Array.from({ length: 40 }, (_, i) => `frame${i}@x.js:${i}:1`).join("\n");
    const lines = describeError(error).split("\n");
    expect(lines[0]).toBe("Error: deep");
    expect(lines).toHaveLength(1 + 12);
  });

  it("describes non-Error values", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError({ code: 42 })).toBe('{"code":42}');
    expect(describeError(undefined)).toBe("undefined");
  });
});

describe("createJsErrorLogger", () => {
  it("writes one line with the source and the place", () => {
    const { lines, logger } = makeLogger();
    logger.report("render", new Error("bad row"), "/dashboard/clusters/minikube");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[js:render\] \/dashboard\/clusters\/minikube Error: bad row/);
  });

  it("redacts secrets that ride in an error message", () => {
    const { lines, logger } = makeLogger();
    logger.report(
      "unhandledrejection",
      new Error("request failed: Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"),
    );
    expect(lines[0]).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(lines[0]).toContain("[REDACTED]");
  });

  it("repeats of the same error inside a minute are counted, not written", () => {
    const { lines, logger, advance } = makeLogger();
    const error = new Error("same");
    error.stack = "";
    logger.report("window.error", error, "/dashboard");
    advance(1_000);
    logger.report("window.error", error);
    logger.report("window.error", error);
    expect(lines).toEqual(["[js:window.error] /dashboard Error: same"]);
  });

  it("writes the repeat count when the minute ends, even if the error never comes back", () => {
    const { lines, logger, advance, pendingTimers } = makeLogger();
    const error = new Error("render loop");
    error.stack = "";
    logger.report("render", error, "/dashboard/clusters/minikube");
    advance(1_000);
    logger.report("render", error);
    logger.report("render", error);
    expect(pendingTimers()).toBe(1);

    advance(58_999);
    expect(lines).toHaveLength(1);
    advance(1);
    expect(lines).toEqual([
      "[js:render] /dashboard/clusters/minikube Error: render loop",
      "[js:render] /dashboard/clusters/minikube Error: render loop (repeated 2 more times within a minute, not logged)",
    ]);
    expect(pendingTimers()).toBe(0);
  });

  it("does not schedule a timer for errors that did not repeat", () => {
    const { logger, pendingTimers } = makeLogger();
    logger.report("window.error", new Error("once"));
    logger.report("window.error", new Error("also once"));
    expect(pendingTimers()).toBe(0);
  });

  it("logs the same error again after its minute, as a new line", () => {
    const { lines, logger, advance } = makeLogger();
    const error = new Error("again");
    error.stack = "";
    logger.report("window.error", error);
    advance(60_000);
    logger.report("window.error", error);
    expect(lines).toEqual(["[js:window.error] Error: again", "[js:window.error] Error: again"]);
  });

  it("keys repeats on the first 200 characters, so long variants of one message count once", () => {
    const { lines, logger } = makeLogger();
    const prefix = "Failed to load row ".repeat(11).slice(0, 200);
    logger.report("window.error", `${prefix} request 1`);
    logger.report("window.error", `${prefix} request 2`);
    expect(lines).toHaveLength(1);
  });

  it("redacts credentials in URLs", () => {
    const { lines, logger } = makeLogger();
    logger.report(
      "unhandledrejection",
      new Error("fetch https://admin:hunter2@10.0.0.1:6443/api failed"),
    );
    expect(lines[0]).not.toContain("hunter2");
    expect(lines[0]).toContain("https://[REDACTED]@10.0.0.1:6443/api");
  });

  it("caps the number of lines per minute so a render loop cannot flood the file", () => {
    const { lines, logger, advance } = makeLogger();
    for (let i = 0; i < JS_ERROR_LIMIT_PER_MINUTE + 10; i++) {
      logger.report("window.error", new Error(`distinct ${i}`));
    }
    expect(lines).toHaveLength(JS_ERROR_LIMIT_PER_MINUTE + 1);
    expect(lines.at(-1)).toMatch(/limit of \d+ JS errors per minute reached/);

    advance(60_001);
    logger.report("window.error", new Error("after the window"));
    expect(lines.at(-1)).toMatch(/after the window/);
  });

  it("never throws, even when the writer throws", () => {
    const logger = createJsErrorLogger({
      write: () => {
        throw new Error("log plugin down");
      },
    });
    expect(() => logger.report("render", new Error("x"))).not.toThrow();
  });

  it("swallows a rejected write so logging cannot raise a new unhandledrejection", async () => {
    const rejected = Promise.reject(new Error("ipc closed"));
    const catchSpy = vi.spyOn(rejected, "catch");
    const logger = createJsErrorLogger({ write: () => rejected });
    logger.report("render", new Error("x"));
    expect(catchSpy).toHaveBeenCalledTimes(1);
    await expect(catchSpy.mock.results[0]?.value).resolves.toBeUndefined();
  });
});

describe("installGlobalErrorLogging", () => {
  let uninstall: (() => void) | null = null;

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("logs uncaught errors with file and position when there is no Error object", () => {
    const { lines, logger } = makeLogger();
    uninstall = installGlobalErrorLogging(window, logger);
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Script error.",
        filename: "tauri://localhost/_app/x.js",
        lineno: 3,
        colno: 9,
      }),
    );
    expect(lines).toEqual(["[js:window.error] Script error. at tauri://localhost/_app/x.js:3:9"]);
  });

  it("logs the Error object of an uncaught error", () => {
    const { lines, logger } = makeLogger();
    uninstall = installGlobalErrorLogging(window, logger);
    const error = new RangeError("index out of range");
    error.stack = "pick@x.js:1:1";
    window.dispatchEvent(new ErrorEvent("error", { message: error.message, error }));
    expect(lines[0]).toBe("[js:window.error] RangeError: index out of range\npick@x.js:1:1");
  });

  it("logs unhandled promise rejections", () => {
    const { lines, logger } = makeLogger();
    uninstall = installGlobalErrorLogging(window, logger);
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("watcher failed") });
    window.dispatchEvent(event);
    expect(lines[0]).toMatch(/^\[js:unhandledrejection\] Error: watcher failed/);
  });

  it("ignores resource load errors (an <img> that 404s is not a JS error)", () => {
    const { lines, logger } = makeLogger();
    uninstall = installGlobalErrorLogging(window, logger);
    window.dispatchEvent(new Event("error"));
    expect(lines).toEqual([]);
  });

  it("stops logging after uninstall", () => {
    const { lines, logger } = makeLogger();
    installGlobalErrorLogging(window, logger)();
    window.dispatchEvent(new ErrorEvent("error", { message: "late" }));
    expect(lines).toEqual([]);
  });
});
